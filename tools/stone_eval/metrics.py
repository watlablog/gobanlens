from __future__ import annotations

from dataclasses import dataclass

import numpy as np

STONE_TO_ID = {"E": 0, "B": 1, "W": 2}
ID_TO_STONE = {0: "E", 1: "B", 2: "W"}


@dataclass
class EvalMetrics:
    board_size: int
    exact_positions: int
    exact_black: int
    exact_white: int
    predicted_black: int
    predicted_white: int
    gt_black: int
    gt_white: int
    white_recall: float
    black_precision: float
    false_black_count: int
    false_white_count: int
    confusion: list[list[int]]

    def to_dict(self) -> dict:
        return {
            "board_size": self.board_size,
            "exact_positions": self.exact_positions,
            "exact_black": self.exact_black,
            "exact_white": self.exact_white,
            "predicted_black": self.predicted_black,
            "predicted_white": self.predicted_white,
            "gt_black": self.gt_black,
            "gt_white": self.gt_white,
            "white_recall": self.white_recall,
            "black_precision": self.black_precision,
            "false_black_count": self.false_black_count,
            "false_white_count": self.false_white_count,
            "confusion": self.confusion,
        }


_COORDS = "abcdefghijklmnopqrstuvwxyz"


def sgf_to_index(coord: str, board_size: int) -> int:
    if len(coord) != 2:
        raise ValueError(f"Invalid SGF coordinate: {coord}")
    col = _COORDS.find(coord[0])
    row = _COORDS.find(coord[1])
    if col < 0 or row < 0 or col >= board_size or row >= board_size:
        raise ValueError(f"Coordinate out of range for board_size={board_size}: {coord}")
    return row * board_size + col


def index_to_sgf(index: int, board_size: int) -> str:
    row = index // board_size
    col = index % board_size
    return f"{_COORDS[col]}{_COORDS[row]}"


def board_from_labels(board_size: int, black: list[str], white: list[str]) -> np.ndarray:
    board = np.zeros(board_size * board_size, dtype=np.int8)
    for coord in black:
        board[sgf_to_index(coord, board_size)] = STONE_TO_ID["B"]
    for coord in white:
        board[sgf_to_index(coord, board_size)] = STONE_TO_ID["W"]
    return board


def coords_from_board(board: np.ndarray, board_size: int, stone_id: int) -> list[str]:
    return [
        index_to_sgf(i, board_size)
        for i, value in enumerate(board.tolist())
        if value == stone_id
    ]


def evaluate_prediction(
    board_size: int,
    predicted: np.ndarray,
    expected: np.ndarray,
) -> EvalMetrics:
    if predicted.shape != expected.shape:
        raise ValueError("Predicted and expected shape mismatch")

    exact_positions = int(np.sum(predicted == expected))
    exact_black = int(np.sum((predicted == 1) & (expected == 1)))
    exact_white = int(np.sum((predicted == 2) & (expected == 2)))
    predicted_black = int(np.sum(predicted == 1))
    predicted_white = int(np.sum(predicted == 2))
    gt_black = int(np.sum(expected == 1))
    gt_white = int(np.sum(expected == 2))

    white_recall = float(exact_white / gt_white) if gt_white > 0 else 1.0
    black_precision = float(exact_black / predicted_black) if predicted_black > 0 else 0.0
    false_black_count = int(predicted_black - exact_black)
    false_white_count = int(predicted_white - exact_white)

    confusion = np.zeros((3, 3), dtype=np.int32)
    for gt_id in range(3):
        for pred_id in range(3):
            confusion[gt_id, pred_id] = int(np.sum((expected == gt_id) & (predicted == pred_id)))

    return EvalMetrics(
        board_size=board_size,
        exact_positions=exact_positions,
        exact_black=exact_black,
        exact_white=exact_white,
        predicted_black=predicted_black,
        predicted_white=predicted_white,
        gt_black=gt_black,
        gt_white=gt_white,
        white_recall=white_recall,
        black_precision=black_precision,
        false_black_count=false_black_count,
        false_white_count=false_white_count,
        confusion=confusion.tolist(),
    )
