#!/usr/bin/env python3
"""Convert SGF position to GobanLens labels JSON.

Supported input:
- setup properties: AB[..], AW[..]
- move sequence: ;B[..], ;W[..] (pass [] is ignored)
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

COORDS = "abcdefghijklmnopqrstuvwxyz"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Convert SGF to labels JSON")
    parser.add_argument("--input", required=True, type=Path, help="Input .sgf path")
    parser.add_argument(
        "--output",
        type=Path,
        default=None,
        help="Output labels JSON path (default: <input>.labels.json)",
    )
    parser.add_argument(
        "--board-size",
        type=int,
        default=None,
        help="Override board size (otherwise SZ[] in SGF is used)",
    )
    return parser.parse_args()


def coord_key(coord: str) -> tuple[int, int]:
    col = COORDS.find(coord[0])
    row = COORDS.find(coord[1])
    return (row, col)


def extract_board_size(sgf: str) -> int:
    match = re.search(r"SZ\[(\d+)\]", sgf)
    if not match:
        return 19
    return int(match.group(1))


def valid_coord(coord: str, board_size: int) -> bool:
    if len(coord) != 2:
        return False
    col = COORDS.find(coord[0])
    row = COORDS.find(coord[1])
    return 0 <= col < board_size and 0 <= row < board_size


def to_labels(sgf: str, board_size: int) -> dict[str, list[str]]:
    black: set[str] = set()
    white: set[str] = set()

    for coord in re.findall(r"AB\[([a-z]{2})\]", sgf):
        if valid_coord(coord, board_size):
            black.add(coord)
            white.discard(coord)

    for coord in re.findall(r"AW\[([a-z]{2})\]", sgf):
        if valid_coord(coord, board_size):
            white.add(coord)
            black.discard(coord)

    for color, coord in re.findall(r";([BW])\[([a-z]{0,2})\]", sgf):
        if coord == "":
            continue
        if not valid_coord(coord, board_size):
            continue
        if color == "B":
            black.add(coord)
            white.discard(coord)
        else:
            white.add(coord)
            black.discard(coord)

    return {
        "boardSize": board_size,
        "black": sorted(black, key=coord_key),
        "white": sorted(white, key=coord_key),
    }


def main() -> None:
    args = parse_args()

    sgf_text = args.input.read_text(encoding="utf-8")
    board_size = args.board_size or extract_board_size(sgf_text)

    payload = to_labels(sgf_text, board_size)

    output = args.output or args.input.with_suffix("").with_suffix(".labels.json")
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(f"Saved: {output}")
    print(f"boardSize={payload['boardSize']} black={len(payload['black'])} white={len(payload['white'])}")


if __name__ == "__main__":
    main()
