from __future__ import annotations

from dataclasses import dataclass
from time import perf_counter
from typing import Any

import cv2
import numpy as np

UNKNOWN_ID = -1
EMPTY_ID = 0
BLACK_ID = 1
WHITE_ID = 2


@dataclass
class PipelineOutput:
    board: np.ndarray
    x_coords: np.ndarray
    y_coords: np.ndarray
    warped_bgr: np.ndarray
    normalized_l: np.ndarray
    dark_binary: np.ndarray
    bright_binary: np.ndarray
    timings: dict[str, float]


DEFAULT_PROFILE: dict[str, Any] = {
    "warp_size": 1024,
    "line_search_shift": 4,
    "line_min_gap_ratio": 0.45,
    "clahe_clip": 2.0,
    "clahe_tile": 8,
    "illum_sigma": 21.0,
    "adaptive_block": 31,
    "adaptive_c": 2,
    "patch_radius_ratio": 4.2,
    "ring_inner_scale": 1.15,
    "ring_outer_scale": 1.95,
    "local_scale": 2.8,
    "normalized_gain": 1.35,
    "stream_select_z_weight": 1.2,
    "stream_select_std_weight": 0.12,
    "stage1_empty_std_max": 21.0,
    "stage1_empty_contrast_abs_max": 12.0,
    "stage1_empty_abs_z_max": 0.24,
    "stage1_black_z_max": -0.56,
    "stage1_black_contrast_min": 22.0,
    "stage1_black_dark_ratio_min": 0.5,
    "stage1_black_chroma_max": 12.0,
    "stage1_white_z_min": 0.2,
    "stage1_white_contrast_min": 14.0,
    "stage1_white_bright_ratio_min": 0.75,
    "stage1_white_dark_ratio_max": 0.26,
    "stage1_white_chroma_max": 9.0,
    "stage2_mad_scale": 1.6,
    "stage2_min_seed_count": 2,
    "stage2_min_margin": 0.3,
    "stage2_unknown_to_empty_bias": 0.15,
    "stage2_z_weight": 1.6,
    "stage2_contrast_weight": 1.6,
    "stage2_ratio_weight": 1.1,
    "stage2_chroma_weight": 0.6,
    "stage2_empty_std_penalty": 0.06,
    "stage2_empty_contrast_penalty": 0.08,
    "stage2_empty_z_penalty": 1.2,
    "stage2_fallback_black_z_max": -0.22,
    "stage2_fallback_black_contrast_min": 10.0,
    "stage2_fallback_black_dark_ratio_min": 0.45,
    "stage2_fallback_white_z_min": 0.05,
    "stage2_fallback_white_contrast_min": 10.0,
    "stage2_fallback_white_bright_ratio_min": 0.7,
    "stage2_fallback_white_dark_ratio_max": 0.32,
    "stage2_fallback_white_chroma_max": 9.0,
    "post_confidence_lock": 0.65,
    "post_isolated_opposite_min": 3,
    "post_dominant_opposite_min": 5,
    "post_max_same_for_flip": 1,
}


def _as_float32_points(points: list[dict[str, float]]) -> np.ndarray:
    result = np.array([[float(p["x"]), float(p["y"])] for p in points], dtype=np.float32)
    if result.shape != (4, 2):
        raise ValueError("corners must contain 4 points")
    return result


def _normalize_l_channel(
    warped_bgr: np.ndarray,
    profile: dict[str, Any],
) -> np.ndarray:
    lab = cv2.cvtColor(warped_bgr, cv2.COLOR_BGR2LAB)
    l = lab[:, :, 0]

    tile = int(profile["clahe_tile"])
    clip = float(profile["clahe_clip"])
    clahe = cv2.createCLAHE(clipLimit=clip, tileGridSize=(tile, tile))
    l_clahe = clahe.apply(l)

    sigma = float(profile["illum_sigma"])
    illum = cv2.GaussianBlur(l_clahe, (0, 0), sigmaX=sigma, sigmaY=sigma)
    normalized = cv2.addWeighted(l_clahe, 1.5, illum, -0.5, 0)
    return normalized.astype(np.float32)


def _build_raw_luma_chroma(warped_bgr: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    b = warped_bgr[:, :, 0].astype(np.float32)
    g = warped_bgr[:, :, 1].astype(np.float32)
    r = warped_bgr[:, :, 2].astype(np.float32)

    raw_luma = 0.2126 * r + 0.7152 * g + 0.0722 * b
    chroma = (np.abs(r - g) + np.abs(g - b) + np.abs(r - b)) / 3.0
    return raw_luma.astype(np.float32), chroma.astype(np.float32)


def _build_normalized_luma(raw_luma: np.ndarray, profile: dict[str, Any]) -> np.ndarray:
    block = int(profile["adaptive_block"])
    block = max(3, block | 1)
    mean_map = cv2.boxFilter(raw_luma, ddepth=-1, ksize=(block, block), borderType=cv2.BORDER_REPLICATE)
    gain = float(profile["normalized_gain"])
    normalized = np.clip(128.0 + (raw_luma - mean_map) * gain, 0.0, 255.0)
    return normalized.astype(np.float32)


def _build_binary_maps(luma: np.ndarray, profile: dict[str, Any]) -> tuple[np.ndarray, np.ndarray]:
    block = int(profile["adaptive_block"])
    block = max(3, block | 1)
    c = float(profile["adaptive_c"])
    luma_u8 = np.clip(luma, 0, 255).astype(np.uint8)

    dark_binary = cv2.adaptiveThreshold(
        luma_u8,
        255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY_INV,
        block,
        c,
    )
    bright_binary = cv2.adaptiveThreshold(
        luma_u8,
        255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY,
        block,
        c,
    )
    return dark_binary, bright_binary


def _line_score_vertical(
    x: int,
    grad_x: np.ndarray,
    line_map: np.ndarray,
) -> float:
    h, w = line_map.shape
    x = int(np.clip(x, 1, w - 2))
    y0 = int(h * 0.05)
    y1 = int(h * 0.95)
    gradient_score = float(np.mean(grad_x[y0:y1, x - 1 : x + 2]))
    line_score = float(np.mean(line_map[y0:y1, x - 1 : x + 2]))
    return gradient_score + 0.8 * line_score


def _line_score_horizontal(
    y: int,
    grad_y: np.ndarray,
    line_map: np.ndarray,
) -> float:
    h, w = line_map.shape
    y = int(np.clip(y, 1, h - 2))
    x0 = int(w * 0.05)
    x1 = int(w * 0.95)
    gradient_score = float(np.mean(grad_y[y - 1 : y + 2, x0:x1]))
    line_score = float(np.mean(line_map[y - 1 : y + 2, x0:x1]))
    return gradient_score + 0.8 * line_score


def _enforce_monotonic(coords: np.ndarray, min_gap: float, low: float, high: float) -> np.ndarray:
    values = coords.copy()
    values[0] = max(low, values[0])
    for i in range(1, len(values)):
        values[i] = max(values[i], values[i - 1] + min_gap)
    values[-1] = min(high, values[-1])
    for i in range(len(values) - 2, -1, -1):
        values[i] = min(values[i], values[i + 1] - min_gap)
    values = np.clip(values, low, high)
    return values


def calibrate_grid_lines(
    normalized_l: np.ndarray,
    dark_binary: np.ndarray,
    board_size: int,
    max_shift: int,
    min_gap_ratio: float,
) -> tuple[np.ndarray, np.ndarray]:
    h, w = normalized_l.shape
    expected = np.linspace(0, w - 1, board_size, dtype=np.float32)

    grad_x = np.abs(np.diff(normalized_l, axis=1))
    grad_x = np.pad(grad_x, ((0, 0), (1, 0)), mode="edge")
    grad_y = np.abs(np.diff(normalized_l, axis=0))
    grad_y = np.pad(grad_y, ((1, 0), (0, 0)), mode="edge")

    x_coords = np.zeros(board_size, dtype=np.float32)
    y_coords = np.zeros(board_size, dtype=np.float32)

    for i, base in enumerate(expected):
        best_x = int(round(base))
        best_score = float("-inf")
        for shift in range(-max_shift, max_shift + 1):
            x = int(round(base + shift))
            score = _line_score_vertical(x, grad_x, dark_binary)
            if score > best_score:
                best_score = score
                best_x = x
        x_coords[i] = float(best_x)

        best_y = int(round(base))
        best_score = float("-inf")
        for shift in range(-max_shift, max_shift + 1):
            y = int(round(base + shift))
            score = _line_score_horizontal(y, grad_y, dark_binary)
            if score > best_score:
                best_score = score
                best_y = y
        y_coords[i] = float(best_y)

    step = (w - 1) / max(1, board_size - 1)
    min_gap = step * float(min_gap_ratio)
    x_coords = _enforce_monotonic(x_coords, min_gap=min_gap, low=0.0, high=float(w - 1))
    y_coords = _enforce_monotonic(y_coords, min_gap=min_gap, low=0.0, high=float(h - 1))

    return x_coords, y_coords


def _point_feature(
    luma: np.ndarray,
    chroma: np.ndarray,
    dark_binary: np.ndarray,
    bright_binary: np.ndarray,
    x: float,
    y: float,
    radius: int,
    ring_inner_scale: float,
    ring_outer_scale: float,
    local_scale: float,
    stream: str,
) -> dict[str, float]:
    h, w = luma.shape
    cx = int(round(x))
    cy = int(round(y))

    center_r = max(2, radius)
    ring_inner = max(center_r + 1, int(round(center_r * ring_inner_scale)))
    ring_outer = max(ring_inner + 1, int(round(center_r * ring_outer_scale)))
    local_r = max(ring_outer + 1, int(round(center_r * local_scale)))
    outer_inner = max(ring_outer + 1, int(round(center_r * (ring_outer_scale + 0.4))))
    outer_outer = max(outer_inner + 1, int(round(center_r * (ring_outer_scale + 1.0))))

    x0 = max(0, cx - local_r)
    x1 = min(w - 1, cx + local_r)
    y0 = max(0, cy - local_r)
    y1 = min(h - 1, cy + local_r)

    yy, xx = np.mgrid[y0 : y1 + 1, x0 : x1 + 1]
    d2 = (xx - cx) ** 2 + (yy - cy) ** 2

    center_mask = d2 <= center_r * center_r
    ring_mask = (d2 >= ring_inner * ring_inner) & (d2 <= ring_outer * ring_outer)
    outer_mask = (d2 >= outer_inner * outer_inner) & (d2 <= outer_outer * outer_outer)
    local_mask = d2 <= local_r * local_r

    patch_l = luma[y0 : y1 + 1, x0 : x1 + 1]
    patch_chroma = chroma[y0 : y1 + 1, x0 : x1 + 1]
    patch_dark = dark_binary[y0 : y1 + 1, x0 : x1 + 1]
    patch_bright = bright_binary[y0 : y1 + 1, x0 : x1 + 1]

    center_vals = patch_l[center_mask]
    ring_vals = patch_l[ring_mask]
    outer_vals = patch_l[outer_mask]
    local_vals = patch_l[local_mask]

    center_l = float(np.mean(center_vals)) if center_vals.size > 0 else 0.0
    ring_l = float(np.mean(ring_vals)) if ring_vals.size > 0 else center_l
    outer_l = float(np.mean(outer_vals)) if outer_vals.size > 0 else ring_l
    local_mean = float(np.mean(local_vals)) if local_vals.size > 0 else center_l
    local_std = float(np.std(local_vals)) if local_vals.size > 0 else 1.0

    center_chroma = float(np.mean(patch_chroma[center_mask])) if np.any(center_mask) else 0.0
    center_dark_ratio = float(np.mean(patch_dark[center_mask] > 0)) if np.any(center_mask) else 0.0
    center_bright_ratio = float(np.mean(patch_bright[center_mask] > 0)) if np.any(center_mask) else 0.0

    z = (center_l - local_mean) / (local_std + 1e-6)
    contrast_mid = center_l - ring_l
    contrast_outer = center_l - outer_l

    return {
        "center_l": center_l,
        "contrast_mid": contrast_mid,
        "contrast_outer": contrast_outer,
        "local_std": local_std,
        "z": float(z),
        "chroma": center_chroma,
        "dark_ratio": center_dark_ratio,
        "bright_ratio": center_bright_ratio,
        "stream": stream,
    }


def _separation_score(feature: dict[str, float], profile: dict[str, Any]) -> float:
    return (
        abs(float(feature["contrast_outer"]))
        + abs(float(feature["z"])) * float(profile["stream_select_z_weight"])
        + float(feature["local_std"]) * float(profile["stream_select_std_weight"])
    )


def _pick_stream_feature(
    raw_feature: dict[str, float],
    normalized_feature: dict[str, float],
    profile: dict[str, Any],
) -> dict[str, float]:
    return normalized_feature if _separation_score(normalized_feature, profile) > _separation_score(raw_feature, profile) else raw_feature


def _median(values: list[float]) -> float:
    if not values:
        return 0.0
    return float(np.median(np.array(values, dtype=np.float32)))


def _build_stat(values: list[float]) -> dict[str, float]:
    med = _median(values)
    dev = [abs(v - med) for v in values]
    mad = max(1e-3, _median(dev))
    return {"median": med, "mad": mad}


def _build_seed_stats(features: list[dict[str, float]]) -> dict[str, Any] | None:
    if not features:
        return None

    z = [float(f["z"]) for f in features]
    contrast = [float(f["contrast_outer"]) for f in features]
    dark = [float(f["dark_ratio"]) for f in features]
    bright = [float(f["bright_ratio"]) for f in features]
    chroma = [float(f["chroma"]) for f in features]
    local_std = [float(f["local_std"]) for f in features]

    return {
        "count": len(features),
        "z": _build_stat(z),
        "contrast_outer": _build_stat(contrast),
        "dark_ratio": _build_stat(dark),
        "bright_ratio": _build_stat(bright),
        "chroma": _build_stat(chroma),
        "local_std": _build_stat(local_std),
        "abs_contrast": _build_stat([abs(v) for v in contrast]),
        "abs_z": _build_stat([abs(v) for v in z]),
    }


def _stage1_seed(feature: dict[str, float], profile: dict[str, Any]) -> str:
    if (
        float(feature["local_std"]) <= float(profile["stage1_empty_std_max"])
        and abs(float(feature["contrast_outer"])) <= float(profile["stage1_empty_contrast_abs_max"])
        and abs(float(feature["z"])) <= float(profile["stage1_empty_abs_z_max"])
    ):
        return "E"

    if (
        float(feature["z"]) <= float(profile["stage1_black_z_max"])
        and float(feature["contrast_outer"]) <= -float(profile["stage1_black_contrast_min"])
        and float(feature["dark_ratio"]) >= float(profile["stage1_black_dark_ratio_min"])
        and float(feature["chroma"]) <= float(profile["stage1_black_chroma_max"])
    ):
        return "B"

    if (
        float(feature["z"]) >= float(profile["stage1_white_z_min"])
        and float(feature["contrast_outer"]) >= float(profile["stage1_white_contrast_min"])
        and float(feature["bright_ratio"]) >= float(profile["stage1_white_bright_ratio_min"])
        and float(feature["dark_ratio"]) <= float(profile["stage1_white_dark_ratio_max"])
        and float(feature["chroma"]) <= float(profile["stage1_white_chroma_max"])
    ):
        return "W"

    return "U"


def _robust_distance(value: float, stat: dict[str, float], scale: float) -> float:
    return abs(value - float(stat["median"])) / (float(stat["mad"]) * scale + 1e-3)


def _score_black(feature: dict[str, float], stats: dict[str, Any] | None, profile: dict[str, Any]) -> float:
    if stats and int(stats["count"]) >= int(profile["stage2_min_seed_count"]):
        return -(
            _robust_distance(float(feature["z"]), stats["z"], float(profile["stage2_mad_scale"])) * float(profile["stage2_z_weight"])
            + _robust_distance(float(feature["contrast_outer"]), stats["contrast_outer"], float(profile["stage2_mad_scale"])) * float(profile["stage2_contrast_weight"])
            + _robust_distance(float(feature["dark_ratio"]), stats["dark_ratio"], float(profile["stage2_mad_scale"])) * float(profile["stage2_ratio_weight"])
            + _robust_distance(float(feature["bright_ratio"]), stats["bright_ratio"], float(profile["stage2_mad_scale"])) * float(profile["stage2_ratio_weight"]) * 0.6
            + _robust_distance(float(feature["chroma"]), stats["chroma"], float(profile["stage2_mad_scale"])) * float(profile["stage2_chroma_weight"])
        )

    score = 0.0
    score -= max(0.0, float(feature["z"]) - float(profile["stage2_fallback_black_z_max"])) * float(profile["stage2_z_weight"]) * 2.0
    score -= max(0.0, float(feature["contrast_outer"]) + float(profile["stage2_fallback_black_contrast_min"])) * float(profile["stage2_contrast_weight"]) * 0.08
    score -= max(0.0, float(profile["stage2_fallback_black_dark_ratio_min"]) - float(feature["dark_ratio"])) * float(profile["stage2_ratio_weight"]) * 2.0
    score -= float(feature["bright_ratio"]) * float(profile["stage2_ratio_weight"]) * 0.4
    score -= float(feature["chroma"]) * float(profile["stage2_chroma_weight"]) * 0.03
    return score


def _score_white(feature: dict[str, float], stats: dict[str, Any] | None, profile: dict[str, Any]) -> float:
    if float(feature["chroma"]) > float(profile["stage2_fallback_white_chroma_max"]) * 1.1:
        return -1000.0

    chroma_overflow = max(0.0, float(feature["chroma"]) - float(profile["stage2_fallback_white_chroma_max"]))

    if stats and int(stats["count"]) >= int(profile["stage2_min_seed_count"]):
        return (
            -(
            _robust_distance(float(feature["z"]), stats["z"], float(profile["stage2_mad_scale"])) * float(profile["stage2_z_weight"])
            + _robust_distance(float(feature["contrast_outer"]), stats["contrast_outer"], float(profile["stage2_mad_scale"])) * float(profile["stage2_contrast_weight"])
            + _robust_distance(float(feature["bright_ratio"]), stats["bright_ratio"], float(profile["stage2_mad_scale"])) * float(profile["stage2_ratio_weight"])
            + _robust_distance(float(feature["dark_ratio"]), stats["dark_ratio"], float(profile["stage2_mad_scale"])) * float(profile["stage2_ratio_weight"]) * 0.6
            + _robust_distance(float(feature["chroma"]), stats["chroma"], float(profile["stage2_mad_scale"])) * float(profile["stage2_chroma_weight"])
        ) - chroma_overflow * float(profile["stage2_chroma_weight"]) * 0.25
        )

    score = 0.0
    score -= max(0.0, float(profile["stage2_fallback_white_z_min"]) - float(feature["z"])) * float(profile["stage2_z_weight"]) * 2.0
    score -= max(0.0, float(profile["stage2_fallback_white_contrast_min"]) - float(feature["contrast_outer"])) * float(profile["stage2_contrast_weight"]) * 0.08
    score -= max(0.0, float(profile["stage2_fallback_white_bright_ratio_min"]) - float(feature["bright_ratio"])) * float(profile["stage2_ratio_weight"]) * 2.0
    score -= max(0.0, float(feature["dark_ratio"]) - float(profile["stage2_fallback_white_dark_ratio_max"])) * float(profile["stage2_ratio_weight"]) * 1.5
    score -= max(0.0, float(feature["chroma"]) - float(profile["stage2_fallback_white_chroma_max"])) * float(profile["stage2_chroma_weight"]) * 0.25
    return score


def _score_empty(feature: dict[str, float], stats: dict[str, Any] | None, profile: dict[str, Any]) -> float:
    score = -(
        max(0.0, float(feature["local_std"]) - float(profile["stage1_empty_std_max"])) * float(profile["stage2_empty_std_penalty"])
        + max(0.0, abs(float(feature["contrast_outer"])) - float(profile["stage1_empty_contrast_abs_max"])) * float(profile["stage2_empty_contrast_penalty"])
        + max(0.0, abs(float(feature["z"])) - float(profile["stage1_empty_abs_z_max"])) * float(profile["stage2_empty_z_penalty"])
    )

    if stats and int(stats["count"]) >= int(profile["stage2_min_seed_count"]):
        score -= _robust_distance(abs(float(feature["contrast_outer"])), stats["abs_contrast"], float(profile["stage2_mad_scale"])) * float(profile["stage2_contrast_weight"]) * 0.8
        score -= _robust_distance(abs(float(feature["z"])), stats["abs_z"], float(profile["stage2_mad_scale"])) * float(profile["stage2_z_weight"]) * 0.6
        score -= _robust_distance(float(feature["local_std"]), stats["local_std"], float(profile["stage2_mad_scale"])) * float(profile["stage2_ratio_weight"]) * 0.4

    return score


def _classify_unknown(
    feature: dict[str, float],
    black_stats: dict[str, Any] | None,
    white_stats: dict[str, Any] | None,
    empty_stats: dict[str, Any] | None,
    profile: dict[str, Any],
) -> tuple[int, float]:
    score_black = _score_black(feature, black_stats, profile)
    score_white = _score_white(feature, white_stats, profile)
    score_empty = _score_empty(feature, empty_stats, profile)
    obvious_wood_highlight = (
        float(feature["chroma"]) > float(profile["stage2_fallback_white_chroma_max"]) * 1.3
        and float(feature["bright_ratio"]) > 0.6
        and float(feature["dark_ratio"]) < 0.45
    )
    if obvious_wood_highlight:
        return EMPTY_ID, 0.0

    def recover_stone() -> int:
        black_recover = (
            float(feature["dark_ratio"]) >= 0.45
            and float(feature["z"]) <= -0.22
            and float(feature["contrast_mid"]) <= -8.0
            and float(feature["chroma"]) <= 10.0
        )
        if black_recover:
            return BLACK_ID

        white_recover1 = (
            float(feature["contrast_outer"]) >= 18.0
            and float(feature["bright_ratio"]) >= 0.72
            and float(feature["dark_ratio"]) <= 0.3
            and float(feature["chroma"]) <= 9.0
        )
        if white_recover1:
            return WHITE_ID

        white_recover2 = (
            float(feature["bright_ratio"]) >= 0.8
            and float(feature["dark_ratio"]) <= 0.22
            and float(feature["contrast_mid"]) >= 10.0
            and float(feature["z"]) >= 0.05
            and float(feature["chroma"]) <= 8.0
        )
        if white_recover2:
            return WHITE_ID

        white_recover3 = (
            float(feature["z"]) >= 0.12
            and float(feature["contrast_outer"]) >= 12.0
            and float(feature["bright_ratio"]) >= 0.7
            and float(feature["dark_ratio"]) <= 0.3
            and float(feature["chroma"]) <= 8.0
        )
        if white_recover3:
            return WHITE_ID

        return EMPTY_ID

    ranked = sorted(
        [
            (BLACK_ID, score_black),
            (WHITE_ID, score_white),
            (EMPTY_ID, score_empty),
        ],
        key=lambda item: item[1],
        reverse=True,
    )

    best_id, best_score = ranked[0]
    second_score = ranked[1][1]
    margin = max(0.0, best_score - second_score)
    if best_id == EMPTY_ID:
        return recover_stone(), margin

    looks_like_wood_highlight = (
        best_id == WHITE_ID
        and float(feature["chroma"]) > float(profile["stage2_fallback_white_chroma_max"]) * 1.3
        and float(feature["bright_ratio"]) > 0.65
    )

    if looks_like_wood_highlight and score_empty >= best_score - float(profile["stage2_unknown_to_empty_bias"]):
        return EMPTY_ID, margin

    if (
        best_id != EMPTY_ID
        and (
            margin < float(profile["stage2_min_margin"])
            or score_empty >= best_score - float(profile["stage2_unknown_to_empty_bias"])
        )
    ):
        recovered = recover_stone()
        if recovered != EMPTY_ID:
            return recovered, margin

        return EMPTY_ID, margin

    return best_id, margin


def _postprocess(
    board: np.ndarray,
    confidence: np.ndarray,
    board_size: int,
    profile: dict[str, Any],
) -> np.ndarray:
    out = board.copy()

    for row in range(board_size):
        for col in range(board_size):
            idx = row * board_size + col
            stone = int(board[idx])
            if stone not in (BLACK_ID, WHITE_ID):
                continue
            if float(confidence[idx]) >= float(profile["post_confidence_lock"]):
                continue

            same = 0
            opposite = 0
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    if dx == 0 and dy == 0:
                        continue
                    nr = row + dy
                    nc = col + dx
                    if nr < 0 or nr >= board_size or nc < 0 or nc >= board_size:
                        continue
                    n_stone = int(board[nr * board_size + nc])
                    if n_stone == stone:
                        same += 1
                    elif n_stone != EMPTY_ID:
                        opposite += 1

            if same == 0 and opposite >= int(profile["post_isolated_opposite_min"]):
                out[idx] = EMPTY_ID
            elif opposite >= int(profile["post_dominant_opposite_min"]) and same <= int(profile["post_max_same_for_flip"]):
                out[idx] = WHITE_ID if stone == BLACK_ID else BLACK_ID

    return out


def classify_stones(
    raw_l: np.ndarray,
    normalized_l: np.ndarray,
    chroma: np.ndarray,
    raw_dark_binary: np.ndarray,
    raw_bright_binary: np.ndarray,
    norm_dark_binary: np.ndarray,
    norm_bright_binary: np.ndarray,
    x_coords: np.ndarray,
    y_coords: np.ndarray,
    profile: dict[str, Any],
) -> tuple[np.ndarray, dict[str, float]]:
    board_size = len(x_coords)
    patch_radius = max(4, int(round(normalized_l.shape[0] / (board_size * float(profile["patch_radius_ratio"])))))

    t_classify_start = perf_counter()

    features: list[dict[str, float]] = []
    for y in y_coords:
        for x in x_coords:
            raw_feature = _point_feature(
                luma=raw_l,
                chroma=chroma,
                dark_binary=raw_dark_binary,
                bright_binary=raw_bright_binary,
                x=float(x),
                y=float(y),
                radius=patch_radius,
                ring_inner_scale=float(profile["ring_inner_scale"]),
                ring_outer_scale=float(profile["ring_outer_scale"]),
                local_scale=float(profile["local_scale"]),
                stream="raw",
            )
            norm_feature = _point_feature(
                luma=normalized_l,
                chroma=chroma,
                dark_binary=norm_dark_binary,
                bright_binary=norm_bright_binary,
                x=float(x),
                y=float(y),
                radius=patch_radius,
                ring_inner_scale=float(profile["ring_inner_scale"]),
                ring_outer_scale=float(profile["ring_outer_scale"]),
                local_scale=float(profile["local_scale"]),
                stream="normalized",
            )
            features.append(_pick_stream_feature(raw_feature, norm_feature, profile))

    board = np.full(board_size * board_size, UNKNOWN_ID, dtype=np.int8)
    confidence = np.zeros(board_size * board_size, dtype=np.float32)

    seed_black: list[dict[str, float]] = []
    seed_white: list[dict[str, float]] = []
    seed_empty: list[dict[str, float]] = []

    for i, feature in enumerate(features):
        seed = _stage1_seed(feature, profile)
        if seed == "B":
            board[i] = BLACK_ID
            confidence[i] = 1.5
            seed_black.append(feature)
        elif seed == "W":
            board[i] = WHITE_ID
            confidence[i] = 1.5
            seed_white.append(feature)
        elif seed == "E":
            board[i] = EMPTY_ID
            confidence[i] = 1.5
            seed_empty.append(feature)

    black_stats = _build_seed_stats(seed_black)
    white_stats = _build_seed_stats(seed_white)
    empty_stats = _build_seed_stats(seed_empty)

    for i, feature in enumerate(features):
        if int(board[i]) != UNKNOWN_ID:
            continue
        stone_id, conf = _classify_unknown(feature, black_stats, white_stats, empty_stats, profile)
        board[i] = np.int8(stone_id)
        confidence[i] = np.float32(conf)

    classify_ms = (perf_counter() - t_classify_start) * 1000.0

    t_post_start = perf_counter()
    post_board = _postprocess(board, confidence, board_size, profile)
    postprocess_ms = (perf_counter() - t_post_start) * 1000.0

    return post_board, {
        "classify_ms": classify_ms,
        "postprocess_ms": postprocess_ms,
    }


def run_pipeline(
    image_bgr: np.ndarray,
    corners: list[dict[str, float]],
    board_size: int,
    profile: dict[str, Any],
) -> PipelineOutput:
    total_start = perf_counter()

    warp_size = int(profile.get("warp_size", DEFAULT_PROFILE["warp_size"]))
    src = _as_float32_points(corners)
    dst = np.array(
        [[0, 0], [warp_size - 1, 0], [warp_size - 1, warp_size - 1], [0, warp_size - 1]],
        dtype=np.float32,
    )

    matrix = cv2.getPerspectiveTransform(src, dst)
    warped = cv2.warpPerspective(image_bgr, matrix, (warp_size, warp_size))

    preprocess_start = perf_counter()
    raw_l, chroma = _build_raw_luma_chroma(warped)
    normalized_l = _normalize_l_channel(warped, profile)
    normalized_l = np.clip((normalized_l + _build_normalized_luma(raw_l, profile)) * 0.5, 0, 255).astype(np.float32)

    raw_dark_binary, raw_bright_binary = _build_binary_maps(raw_l, profile)
    norm_dark_binary, norm_bright_binary = _build_binary_maps(normalized_l, profile)

    x_coords, y_coords = calibrate_grid_lines(
        normalized_l=normalized_l,
        dark_binary=norm_dark_binary,
        board_size=board_size,
        max_shift=int(profile["line_search_shift"]),
        min_gap_ratio=float(profile["line_min_gap_ratio"]),
    )
    preprocess_ms = (perf_counter() - preprocess_start) * 1000.0

    board, classify_timings = classify_stones(
        raw_l=raw_l,
        normalized_l=normalized_l,
        chroma=chroma,
        raw_dark_binary=raw_dark_binary,
        raw_bright_binary=raw_bright_binary,
        norm_dark_binary=norm_dark_binary,
        norm_bright_binary=norm_bright_binary,
        x_coords=x_coords,
        y_coords=y_coords,
        profile=profile,
    )

    total_ms = (perf_counter() - total_start) * 1000.0

    return PipelineOutput(
        board=board,
        x_coords=x_coords,
        y_coords=y_coords,
        warped_bgr=warped,
        normalized_l=normalized_l,
        dark_binary=norm_dark_binary,
        bright_binary=norm_bright_binary,
        timings={
            "preprocess_ms": preprocess_ms,
            "classify_ms": classify_timings["classify_ms"],
            "postprocess_ms": classify_timings["postprocess_ms"],
            "total_ms": total_ms,
        },
    )
