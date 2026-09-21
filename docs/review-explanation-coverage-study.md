# Review explanation coverage study

| tier | contested | resolved | count | percent |
| --- | --- | --- | ---: | ---: |
| exact | yes | yes | 0 | 0.0% |
| exact | yes | no | 0 | 0.0% |
| exact | no | yes | 3 | 0.4% |
| exact | no | no | 15 | 1.8% |
| search | yes | yes | 45 | 5.4% |
| search | yes | no | 111 | 13.2% |
| search | no | yes | 53 | 6.3% |
| search | no | no | 291 | 34.6% |
| heuristic | yes | yes | 45 | 5.4% |
| heuristic | yes | no | 97 | 11.5% |
| heuristic | no | yes | 14 | 1.7% |
| heuristic | no | no | 166 | 19.8% |
| overall | all | all | 840 | 100.0% |

## Resolved: false value gaps

| value gap magnitude | count | percent | min | median | max |
| --- | ---: | ---: | ---: | ---: | ---: |
| 0 | 633 | 93.1% | — | — | — |
| nonzero | 47 | 6.9% | 0.01 | 1 | 11.61 |

## Rendered prose coverage

| bucket | count | percent |
| --- | ---: | ---: |
| positional | 160 | 19.0% |
| value-gap | 30 | 3.6% |
| no-difference | 650 | 77.4% |
| supported-sentence coverage | 190 | 22.6% |

| supported-sentence coverage (played != reference) | 190 | 67.6% |

## Rendered no-difference denominator breakdown

| tier | played == reference | played != reference, exactly zero | played != reference, below 0.25 | played != reference, non-reference-favoring |
| --- | ---: | ---: | ---: | ---: |
| exact | 13 | 0 | 0 | 0 |
| search | 353 | 12 | 9 | 0 |
| heuristic | 193 | 70 | 0 | 0 |
| overall | 559 | 82 | 9 | 0 |

## Eligible missKind distribution

| missKind | count |
| --- | ---: |
| correct | 559 |
| reply_risk | 104 |
| same_tile_wrong_end | 60 |
| unknown | 117 |

## Jitter measurement

Two fresh independent facts passes were compared because canonical per-record facts were not persisted.

| eligible decisions compared | 840 |
| contested flips | 4 |
| rendered top-level bucket flips | 0 |
| denominator sub-split flips | 0 |
| capped-severity flips | 0 |
