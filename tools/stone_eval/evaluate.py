from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import cv2
import numpy as np

from metrics import board_from_labels, coords_from_board, evaluate_prediction
from pipeline import DEFAULT_PROFILE, run_pipeline


def load_json(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as fp:
        return json.load(fp)


def merge_profile(base: dict[str, Any], override: dict[str, Any]) -> dict[str, Any]:
    merged = dict(base)
    merged.update(override)
    return merged


def candidate_profiles(base_profile: dict[str, Any], enable_grid_search: bool) -> list[dict[str, Any]]:
    if not enable_grid_search:
        return [base_profile]

    candidates: list[dict[str, Any]] = []

    stage1_white_z_values = [0.16, 0.2, 0.24]
    stage1_white_contrast_values = [12.0, 14.0, 16.0]
    stage1_black_z_values = [-0.62, -0.56, -0.5]
    stage1_black_contrast_values = [18.0, 22.0, 26.0]
    margin_values = [0.24, 0.3, 0.38]
    empty_bias_values = [0.1, 0.15, 0.2]

    for white_z in stage1_white_z_values:
        for white_contrast in stage1_white_contrast_values:
            for black_z in stage1_black_z_values:
                for black_contrast in stage1_black_contrast_values:
                    for margin in margin_values:
                        for empty_bias in empty_bias_values:
                            candidate = dict(base_profile)
                            candidate["stage1_white_z_min"] = white_z
                            candidate["stage1_white_contrast_min"] = white_contrast
                            candidate["stage1_black_z_max"] = black_z
                            candidate["stage1_black_contrast_min"] = black_contrast
                            candidate["stage2_min_margin"] = margin
                            candidate["stage2_unknown_to_empty_bias"] = empty_bias
                            candidates.append(candidate)

    return candidates


def select_best(
    image_bgr: np.ndarray,
    corners: list[dict[str, float]],
    board_size: int,
    expected_board: np.ndarray,
    profiles: list[dict[str, Any]],
) -> tuple[dict[str, Any], dict[str, Any], Any]:
    best_profile: dict[str, Any] | None = None
    best_metrics: dict[str, Any] | None = None
    best_output = None
    best_score = -10**9

    for profile in profiles:
        output = run_pipeline(
            image_bgr=image_bgr,
            corners=corners,
            board_size=board_size,
            profile=profile,
        )
        metrics = evaluate_prediction(board_size=board_size, predicted=output.board, expected=expected_board)

        count_error = abs(metrics.predicted_black - metrics.gt_black) + abs(metrics.predicted_white - metrics.gt_white)
        false_stones = metrics.false_black_count + metrics.false_white_count
        score = metrics.exact_positions * 1000 - count_error * 120 - false_stones * 35

        if score > best_score:
            best_score = score
            best_profile = profile
            best_metrics = metrics.to_dict()
            best_output = output

    if best_profile is None or best_metrics is None or best_output is None:
        raise RuntimeError("No profile evaluated")

    return best_profile, best_metrics, best_output


def write_debug_images(output_dir: Path, output: Any) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(output_dir / "warped.jpg"), output.warped_bgr)

    normalized_u8 = np.clip(output.normalized_l, 0, 255).astype(np.uint8)
    cv2.imwrite(str(output_dir / "normalized_l.jpg"), normalized_u8)
    cv2.imwrite(str(output_dir / "dark_binary.jpg"), output.dark_binary)
    cv2.imwrite(str(output_dir / "bright_binary.jpg"), output.bright_binary)

    overlay = output.warped_bgr.copy()
    for x in output.x_coords:
        x_int = int(round(x))
        cv2.line(overlay, (x_int, 0), (x_int, overlay.shape[0] - 1), (0, 200, 0), 1)
    for y in output.y_coords:
        y_int = int(round(y))
        cv2.line(overlay, (0, y_int), (overlay.shape[1] - 1, y_int), (0, 200, 0), 1)
    cv2.imwrite(str(output_dir / "grid_overlay.jpg"), overlay)


def main() -> None:
    parser = argparse.ArgumentParser(description="Evaluate GobanLens stone estimation against labeled sample")
    parser.add_argument("--image", required=True, help="Input image path")
    parser.add_argument("--meta", required=True, help="Meta JSON path")
    parser.add_argument("--labels", required=True, help="Labels JSON path")
    parser.add_argument("--profile", default="", help="Optional profile JSON path")
    parser.add_argument("--grid-search", action="store_true", help="Enable profile grid-search")
    parser.add_argument("--out-dir", default="tools/stone_eval/out", help="Output directory")

    args = parser.parse_args()

    image_path = Path(args.image)
    meta_path = Path(args.meta)
    labels_path = Path(args.labels)
    out_dir = Path(args.out_dir)

    image_bgr = cv2.imread(str(image_path))
    if image_bgr is None:
        raise FileNotFoundError(f"Failed to load image: {image_path}")

    meta = load_json(meta_path)
    labels = load_json(labels_path)
    board_size = int(labels["boardSize"])

    if int(meta["boardSize"]) != board_size:
        raise ValueError("meta.boardSize and labels.boardSize mismatch")

    profile_override = load_json(Path(args.profile)) if args.profile else {}
    base_profile = merge_profile(DEFAULT_PROFILE, profile_override)
    base_profile["warp_size"] = int(meta.get("warpSize", base_profile["warp_size"]))

    expected_board = board_from_labels(
        board_size=board_size,
        black=list(labels.get("black", [])),
        white=list(labels.get("white", [])),
    )

    profiles = candidate_profiles(base_profile, enable_grid_search=bool(args.grid_search))
    best_profile, best_metrics, best_output = select_best(
        image_bgr=image_bgr,
        corners=list(meta["corners"]),
        board_size=board_size,
        expected_board=expected_board,
        profiles=profiles,
    )

    predicted_black = coords_from_board(best_output.board, board_size, stone_id=1)
    predicted_white = coords_from_board(best_output.board, board_size, stone_id=2)

    payload = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "image": str(image_path),
        "meta": str(meta_path),
        "labels": str(labels_path),
        "profile": best_profile,
        "metrics": best_metrics,
        "timings_ms": best_output.timings,
        "predicted": {
            "black": predicted_black,
            "white": predicted_white,
        },
    }

    run_out_dir = out_dir / image_path.stem
    run_out_dir.mkdir(parents=True, exist_ok=True)
    report_path = run_out_dir / "best_result.json"
    with report_path.open("w", encoding="utf-8") as fp:
        json.dump(payload, fp, ensure_ascii=False, indent=2)

    write_debug_images(run_out_dir, best_output)

    print(json.dumps(payload, ensure_ascii=False, indent=2))
    print(f"Saved: {report_path}")


if __name__ == "__main__":
    main()
