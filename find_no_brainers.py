#!/usr/bin/env python3
from __future__ import annotations

import csv
import json
from dataclasses import dataclass
from functools import lru_cache
from itertools import combinations
from typing import Dict, List, Optional, Tuple

Pip = int
Tile = Tuple[Pip, Pip]  # (a,b) with a<=b
OpenCounts = Tuple[int, int, int, int, int, int, int]  # counts for pips 0..6


def all_tiles_double_six() -> List[Tile]:
    tiles: List[Tile] = []
    for a in range(7):
        for b in range(a, 7):
            tiles.append((a, b))
    assert len(tiles) == 28
    return tiles


def tile_str(t: Tile) -> str:
    return f"{t[0]}|{t[1]}"


def is_double(t: Tile) -> bool:
    return t[0] == t[1]


def open_add(open_counts: OpenCounts, pip: Pip, delta: int) -> OpenCounts:
    lst = list(open_counts)
    lst[pip] += delta
    return tuple(lst)  # type: ignore


def playable_moves(open_counts: Optional[OpenCounts], tile: Tile) -> List[Tuple[Pip, Pip]]:
    """
    Returns a list of oriented plays (match_pip, other_pip) that are legal.
    - If open_counts is None -> board empty: any tile can be played (two orientations if non-double).
    - Else: you must match one open end.
    """
    a, b = tile
    moves: List[Tuple[Pip, Pip]] = []

    if open_counts is None:
        # First tile: can play either orientation
        moves.append((a, b))
        if a != b:
            moves.append((b, a))
        return moves

    # Must match an open end
    if open_counts[a] > 0:
        moves.append((a, b))
    if a != b and open_counts[b] > 0:
        moves.append((b, a))

    return moves


def apply_play(open_counts: Optional[OpenCounts], match: Pip, other: Pip) -> OpenCounts:
    """
    Apply a play that matches `match` on an open end, producing new open ends.
    Open ends are modeled as a multiset of pip values.

    Rules:
    - If board empty: after playing a|b -> opens {a,b} (double -> {a,a})
    - Non-double played on match: consume one open match, add one open other
    - Double x|x played on match=x: consume one open x, add two opens x (net +1 x)
    """
    if open_counts is None:
        # First tile creates two opens (or two of same pip if double)
        opens = (0, 0, 0, 0, 0, 0, 0)
        opens = open_add(opens, match, 1)
        opens = open_add(opens, other, 1)
        return opens

    # Consume the matched open end
    new_opens = open_add(open_counts, match, -1)

    if match == other:
        # Double: adds TWO opens of same pip (net +1 from consume+2 add)
        new_opens = open_add(new_opens, other, 2)
    else:
        # Non-double: adds one open of the other pip
        new_opens = open_add(new_opens, other, 1)

    return new_opens


@dataclass(frozen=True)
class HandResult:
    hand_tiles: Tuple[Tile, ...]
    example_sequence: Tuple[Tile, ...]  # one sequence that works (optional but useful)


def find_no_brainer_hands() -> List[HandResult]:
    """
    Finds every 7-tile hand where there exists a legal sequence of plays that:
    - Starts from empty board
    - Uses all 7 tiles in one turn
    - Cannot end on a double (final tile must be non-double)
    - Turn continues only after playing a double (per your rules)
      => therefore first 6 must be doubles, last must be non-double
    """

    tiles = all_tiles_double_six()
    doubles = [t for t in tiles if is_double(t)]         # 7 tiles
    nondoubles = [t for t in tiles if not is_double(t)]  # 21 tiles

    results: List[HandResult] = []

    # Candidate hands are exactly: 6 doubles + 1 non-double
    for dbl6 in combinations(doubles, 6):
        for nd in nondoubles:
            hand = tuple(sorted(dbl6 + (nd,)))  # for stable representation

            # For searching, we need to know which tile is the lone non-double
            nd_tile = nd

            # The only viable structure: play 6 doubles (in some order), then nd last.
            # We'll DFS over orderings with pruning + memo.
            doubles_in_hand = tuple([t for t in hand if is_double(t)])
            assert len(doubles_in_hand) == 6

            @lru_cache(maxsize=None)
            def dfs(remaining_doubles: Tuple[Tile, ...], open_counts: Optional[OpenCounts]) -> Optional[Tuple[Tile, ...]]:
                """
                Returns an example sequence of remaining doubles that can be played
                starting from open_counts, OR None if impossible.
                """
                if not remaining_doubles:
                    # After all doubles are played, we must be able to play the non-double and end.
                    # End condition: nd is playable now AND nd is non-double (it is).
                    for (match, other) in playable_moves(open_counts, nd_tile):
                        # playing it ends the turn; legality only matters
                        _ = apply_play(open_counts, match, other)
                        return tuple()  # success; no more doubles needed
                    return None

                # Try each next double
                for i, t in enumerate(remaining_doubles):
                    for (match, other) in playable_moves(open_counts, t):
                        new_open = apply_play(open_counts, match, other)
                        next_remaining = remaining_doubles[:i] + remaining_doubles[i+1:]
                        suffix = dfs(next_remaining, new_open)
                        if suffix is not None:
                            return (t,) + suffix

                return None

            seq_doubles = dfs(doubles_in_hand, None)
            if seq_doubles is not None:
                # Build full example sequence: 6 doubles + final non-double
                example = tuple(seq_doubles) + (nd_tile,)
                results.append(HandResult(hand_tiles=hand, example_sequence=example))

    return results


def main() -> None:
    results = find_no_brainer_hands()
    print(f"Found {len(results)} no-brainer hands.")

    # Write JSONL (one hand per line)
    with open("no_brainer_hands.jsonl", "w", encoding="utf-8") as f:
        for r in results:
            obj = {
                "hand": [tile_str(t) for t in r.hand_tiles],
                "example": [tile_str(t) for t in r.example_sequence],  # useful for practice hints
            }
            f.write(json.dumps(obj) + "\n")

    # Write CSV
    with open("no_brainer_hands.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["hand", "example_sequence"])
        for r in results:
            w.writerow(
                [" ".join(tile_str(t) for t in r.hand_tiles),
                 " -> ".join(tile_str(t) for t in r.example_sequence)]
            )

    print("Wrote no_brainer_hands.jsonl and no_brainer_hands.csv")


if __name__ == "__main__":
    main()
