#!/usr/bin/env python3
"""Interactive board label editor.

Create board labels by clicking intersections and export to JSON:
{
  "boardSize": 19,
  "black": ["dd", ...],
  "white": ["pq", ...]
}
"""

from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from pathlib import Path
import sys

try:
    import tkinter as tk
    from tkinter import filedialog, messagebox
except ModuleNotFoundError:
    tk = None  # type: ignore[assignment]
    filedialog = None  # type: ignore[assignment]
    messagebox = None  # type: ignore[assignment]

SGF_COORDS = "abcdefghijklmnopqrstuvwxyz"
VALID_SIZES = (9, 13, 19)


@dataclass(frozen=True)
class GridPoint:
    row: int
    col: int


class BoardLabelerApp:
    def __init__(self, initial_size: int, initial_output: Path | None) -> None:
        self.root = tk.Tk()
        self.root.title("GobanLens Board Labeler")

        self.canvas_size = 760
        self.margin = 36
        self.board_size_var = tk.IntVar(value=initial_size)
        self.status_var = tk.StringVar(value="交点クリック: 空 -> 黒 -> 白 -> 空")
        self.count_var = tk.StringVar(value="黒: 0 / 白: 0")
        self.output_path: Path | None = initial_output

        self.stones: dict[GridPoint, str] = {}

        self._build_ui()
        self._redraw_all()

    def _build_ui(self) -> None:
        main = tk.Frame(self.root)
        main.pack(fill=tk.BOTH, expand=True, padx=10, pady=10)

        top = tk.Frame(main)
        top.pack(fill=tk.X, pady=(0, 8))

        tk.Label(top, text="盤サイズ").pack(side=tk.LEFT)
        size_menu = tk.OptionMenu(top, self.board_size_var, *VALID_SIZES, command=self._on_board_size_change)
        size_menu.pack(side=tk.LEFT, padx=(6, 12))

        tk.Button(top, text="クリア", command=self.clear_board).pack(side=tk.LEFT, padx=4)
        tk.Button(top, text="JSON保存", command=self.save_json).pack(side=tk.LEFT, padx=4)
        tk.Button(top, text="JSON読込", command=self.load_json).pack(side=tk.LEFT, padx=4)
        tk.Button(top, text="クリップボードコピー", command=self.copy_json_to_clipboard).pack(side=tk.LEFT, padx=4)

        self.canvas = tk.Canvas(
            main,
            width=self.canvas_size,
            height=self.canvas_size,
            bg="#d7b97c",
            highlightthickness=1,
            highlightbackground="#8f7445",
        )
        self.canvas.pack(fill=tk.BOTH, expand=False)
        self.canvas.bind("<Button-1>", self._on_canvas_click)

        bottom = tk.Frame(main)
        bottom.pack(fill=tk.X, pady=(8, 0))
        tk.Label(bottom, textvariable=self.count_var).pack(side=tk.LEFT)
        tk.Label(bottom, textvariable=self.status_var, fg="#555").pack(side=tk.RIGHT)

    @property
    def board_size(self) -> int:
        return int(self.board_size_var.get())

    @property
    def step(self) -> float:
        return (self.canvas_size - self.margin * 2) / (self.board_size - 1)

    def _xy_from_row_col(self, row: int, col: int) -> tuple[float, float]:
        return (
            self.margin + col * self.step,
            self.margin + row * self.step,
        )

    def _nearest_grid_point(self, x: float, y: float) -> GridPoint | None:
        col = round((x - self.margin) / self.step)
        row = round((y - self.margin) / self.step)

        if not (0 <= col < self.board_size and 0 <= row < self.board_size):
            return None

        px, py = self._xy_from_row_col(row, col)
        dist2 = (x - px) ** 2 + (y - py) ** 2
        if dist2 > (self.step * 0.45) ** 2:
            return None

        return GridPoint(row=row, col=col)

    def _toggle_stone(self, point: GridPoint) -> None:
        current = self.stones.get(point)
        if current is None:
            self.stones[point] = "B"
        elif current == "B":
            self.stones[point] = "W"
        else:
            self.stones.pop(point, None)

    def _on_canvas_click(self, event: tk.Event) -> None:
        point = self._nearest_grid_point(event.x, event.y)
        if point is None:
            return

        self._toggle_stone(point)
        self._redraw_all()

    def _on_board_size_change(self, _value: str) -> None:
        if self.stones:
            keep = messagebox.askyesno(
                "盤サイズ変更",
                "盤サイズを変更すると現在の石配置をクリアします。続けますか？",
            )
            if not keep:
                return
        self.stones.clear()
        self._redraw_all()

    def _redraw_all(self) -> None:
        self.canvas.delete("all")
        self._draw_grid()
        self._draw_stones()
        self._update_counts()

    def _draw_grid(self) -> None:
        n = self.board_size
        step = self.step
        m = self.margin

        for i in range(n):
            p = m + i * step
            self.canvas.create_line(m, p, m + (n - 1) * step, p, fill="#5f4a26", width=1)
            self.canvas.create_line(p, m, p, m + (n - 1) * step, fill="#5f4a26", width=1)

        for row, col in self._star_points(n):
            x, y = self._xy_from_row_col(row, col)
            r = 3
            self.canvas.create_oval(x - r, y - r, x + r, y + r, fill="#3f3019", outline="")

    def _draw_stones(self) -> None:
        radius = max(7, self.step * 0.43)
        for point, stone in self.stones.items():
            x, y = self._xy_from_row_col(point.row, point.col)
            if stone == "B":
                self.canvas.create_oval(
                    x - radius,
                    y - radius,
                    x + radius,
                    y + radius,
                    fill="#101010",
                    outline="#000000",
                    width=1,
                )
            else:
                self.canvas.create_oval(
                    x - radius,
                    y - radius,
                    x + radius,
                    y + radius,
                    fill="#f5f5f5",
                    outline="#8e8e8e",
                    width=1,
                )

    def _star_points(self, n: int) -> list[tuple[int, int]]:
        if n == 19:
            values = [3, 9, 15]
        elif n == 13:
            values = [3, 6, 9]
        elif n == 9:
            values = [2, 4, 6]
        else:
            return []
        return [(r, c) for r in values for c in values]

    def _update_counts(self) -> None:
        black = sum(1 for s in self.stones.values() if s == "B")
        white = sum(1 for s in self.stones.values() if s == "W")
        self.count_var.set(f"黒: {black} / 白: {white}")

    def clear_board(self) -> None:
        self.stones.clear()
        self._redraw_all()
        self.status_var.set("盤面をクリアしました")

    def _stone_lists(self) -> tuple[list[str], list[str]]:
        black: list[str] = []
        white: list[str] = []

        for point, stone in sorted(self.stones.items(), key=lambda item: (item[0].row, item[0].col)):
            coord = self._to_sgf(point)
            if stone == "B":
                black.append(coord)
            elif stone == "W":
                white.append(coord)

        return black, white

    def _to_sgf(self, point: GridPoint) -> str:
        return f"{SGF_COORDS[point.col]}{SGF_COORDS[point.row]}"

    def _to_json_payload(self) -> dict:
        black, white = self._stone_lists()
        return {
            "boardSize": self.board_size,
            "black": black,
            "white": white,
        }

    def save_json(self) -> None:
        default = self.output_path or Path(f"labels-{self.board_size}.json")
        path = filedialog.asksaveasfilename(
            title="labels.json を保存",
            defaultextension=".json",
            initialfile=default.name,
            filetypes=[("JSON", "*.json")],
        )
        if not path:
            return

        output = Path(path)
        payload = self._to_json_payload()
        output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

        self.output_path = output
        self.status_var.set(f"保存しました: {output}")

    def load_json(self) -> None:
        path = filedialog.askopenfilename(
            title="labels.json を開く",
            filetypes=[("JSON", "*.json")],
        )
        if not path:
            return

        payload = json.loads(Path(path).read_text(encoding="utf-8"))
        board_size = int(payload.get("boardSize", self.board_size))
        if board_size not in VALID_SIZES:
            messagebox.showerror("読込エラー", f"未対応の boardSize です: {board_size}")
            return

        self.board_size_var.set(board_size)
        self.stones.clear()

        for coord in payload.get("black", []):
            point = self._point_from_sgf(coord)
            if point:
                self.stones[point] = "B"

        for coord in payload.get("white", []):
            point = self._point_from_sgf(coord)
            if point:
                self.stones[point] = "W"

        self.output_path = Path(path)
        self._redraw_all()
        self.status_var.set(f"読込しました: {path}")

    def _point_from_sgf(self, coord: str) -> GridPoint | None:
        if not isinstance(coord, str) or len(coord) != 2:
            return None
        col = SGF_COORDS.find(coord[0])
        row = SGF_COORDS.find(coord[1])
        if col < 0 or row < 0:
            return None
        if col >= self.board_size or row >= self.board_size:
            return None
        return GridPoint(row=row, col=col)

    def copy_json_to_clipboard(self) -> None:
        payload = self._to_json_payload()
        content = json.dumps(payload, ensure_ascii=False, indent=2)
        self.root.clipboard_clear()
        self.root.clipboard_append(content)
        self.status_var.set("JSONをクリップボードにコピーしました")

    def run(self) -> None:
        self.root.mainloop()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Interactive board label editor")
    parser.add_argument(
        "--board-size",
        type=int,
        default=19,
        choices=VALID_SIZES,
        help="Board size (9/13/19)",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=None,
        help="Default output path for save dialog",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if tk is None:
        print(
            "Error: tkinter is not available in this Python environment.\n"
            "Install Python with Tk support and run again.",
            file=sys.stderr,
        )
        raise SystemExit(2)
    app = BoardLabelerApp(initial_size=args.board_size, initial_output=args.output)
    app.run()


if __name__ == "__main__":
    main()
