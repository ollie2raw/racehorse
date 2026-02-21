import csv
import json
from functools import lru_cache
from typing import List, Optional, Tuple, Dict

Pip = int
Tile = Tuple[Pip, Pip]          # stored as (a,b) with a<=b
OpenCounts = Tuple[int, int, int, int, int, int, int]  # counts of open ends for pips 0..6

def all_tiles_double_six() -> List[Tile]:
    tiles: List[Tile] = []
    for a in range(7):
        for b in range(a, 7):
            tiles.append((a, b))
    assert len(tiles) == 28
    return tiles

TILES: List[Tile] = all_tiles_double_six()

def is_double(t: Tile) -> bool:
    return t[0] == t[1]

def tile_str(t: Tile) -> str:
    return f"{t[0]}|{t[1]}"

def open_sum(opens: OpenCounts) -> int:
    # sum of pip values across all open ends
    return sum(pip * opens[pip] for pip in range(7))

def score5(opens: OpenCounts) -> bool:
    s = open_sum(opens)
    return s != 0 and (s % 5 == 0)

def open_add(opens: OpenCounts, pip: Pip, delta: int) -> OpenCounts:
    lst = list(opens)
    lst[pip] += delta
    return tuple(lst)  # type: ignore

def playable_orientations(opens: Optional[OpenCounts], tile: Tile) -> List[Tuple[Pip, Pip]]:
    """
    Returns oriented (match, other) plays that are legal.
    - If opens is None (empty board): any tile can be played in either orientation (if non-double).
    - Else: must match an open end.
    """
    a, b = tile
    res: List[Tuple[Pip, Pip]] = []

    if opens is None:
        res.append((a, b))
        if a != b:
            res.append((b, a))
        return res

    if opens[a] > 0:
        res.append((a, b))
    if a != b and opens[b] > 0:
        res.append((b, a))

    return res

def apply_play(opens: Optional[OpenCounts], match: Pip, other: Pip) -> OpenCounts:
    """
    Apply oriented play (match, other) to the multiset of open ends.

    If empty board:
      opens become {match, other} (double => {x, x})

    If not empty:
      - consume one open end == match
      - if double (match==other): add two opens of that pip
      - else: add one open of `other`
    """
    if opens is None:
        base: OpenCounts = (0, 0, 0, 0, 0, 0, 0)
        base = open_add(base, match, 1)
        base = open_add(base, other, 1)
        return base

    new_opens = open_add(opens, match, -1)
    if match == other:
        # double adds TWO (net +1 after consume)
        new_opens = open_add(new_opens, other, 2)
    else:
        new_opens = open_add(new_opens, other, 1)
    return new_opens

def find_no_brainer_hands() -> Dict[Tuple[int, ...], List[int]]:
    """
    Returns dict:
      key = sorted tuple of tile indices (the 7-tile hand)
      value = one example sequence of tile indices (length 7) that is a no-brainer
    """

    # Store first found example sequence per hand
    solutions: Dict[Tuple[int, ...], List[int]] = {}

    # DFS state:
    # depth = number of tiles already played (0..7)
    # used_mask = bitmask over 28 tiles
    # opens = None for empty board else OpenCounts
    # sequence = list of indices played so far

    # Memoize failure states to prune:
    # If from (depth, used_mask, opens) you cannot finish to a success, mark false.
    @lru_cache(maxsize=None)
    def can_finish(depth: int, used_mask: int, opens: Optional[OpenCounts]) -> bool:
        # If already played 7 tiles, success if we got here through the right constraints (enforced outside)
        if depth == 7:
            return True

        # We are about to pick the (depth+1)th tile.
        # For moves 1..6 (i.e., after placing them), we REQUIRE continue=True.
        # For move 7 (final), we REQUIRE continue=False and tile must be non-double.
        is_final_move = (depth == 6)

        # Try each unused tile, check legality, apply, check continuation condition.
        for idx, tile in enumerate(TILES):
            if (used_mask >> idx) & 1:
                continue

            for (match, other) in playable_orientations(opens, tile):
                new_opens = apply_play(opens, match, other)
                scored = score5(new_opens)
                cont = is_double(tile) or scored

                if is_final_move:
                    # final tile must end turn: non-double AND non-score
                    if is_double(tile) or scored:
                        continue
                    # ok: cont is false automatically if both are false
                else:
                    # must continue after this move
                    if not cont:
                        continue

                new_mask = used_mask | (1 << idx)
                if can_finish(depth + 1, new_mask, new_opens):
                    return True

        return False

    def build_one_sequence(depth: int, used_mask: int, opens: Optional[OpenCounts], seq: List[int]) -> bool:
        if depth == 7:
            # record hand
            hand = tuple(sorted(seq))
            if hand not in solutions:
                solutions[hand] = seq.copy()
            return True

        is_final_move = (depth == 6)

        for idx, tile in enumerate(TILES):
            if (used_mask >> idx) & 1:
                continue

            for (match, other) in playable_orientations(opens, tile):
                new_opens = apply_play(opens, match, other)
                scored = score5(new_opens)
                cont = is_double(tile) or scored

                if is_final_move:
                    if is_double(tile) or scored:
                        continue
                else:
                    if not cont:
                        continue

                new_mask = used_mask | (1 << idx)

                # prune via memo
                if not can_finish(depth + 1, new_mask, new_opens):
                    continue

                seq.append(idx)
                ok = build_one_sequence(depth + 1, new_mask, new_opens, seq)
                if ok:
                    # keep searching to gather more hands, but don’t need multiple sequences per hand
                    pass
                seq.pop()

        return True

    # Kick off full search from empty board
    build_one_sequence(0, 0, None, [])

    return solutions

def main() -> None:
    sols = find_no_brainer_hands()
    print(f"Found {len(sols)} no-brainer hands (score-by-5 continuation).")

    # Write JSONL
    with open("no_brainer_hands.jsonl", "w", encoding="utf-8") as f:
        for hand_idxs, seq_idxs in sols.items():
            hand_tiles = [tile_str(TILES[i]) for i in hand_idxs]
            example_seq = [tile_str(TILES[i]) for i in seq_idxs]
            f.write(json.dumps({"hand": hand_tiles, "example": example_seq}) + "\n")

    # Write CSV
    with open("no_brainer_hands.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["hand_tiles", "example_sequence"])
        for hand_idxs, seq_idxs in sols.items():
            hand_tiles = " ".join(tile_str(TILES[i]) for i in hand_idxs)
            example_seq = " -> ".join(tile_str(TILES[i]) for i in seq_idxs)
            w.writerow([hand_tiles, example_seq])

    print("Wrote no_brainer_hands.jsonl and no_brainer_hands.csv")

if __name__ == "__main__":
    main()
