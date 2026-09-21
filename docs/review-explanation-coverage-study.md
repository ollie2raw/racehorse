# Review explanation coverage study

| tier | contested | resolved | count | percent |
| --- | --- | --- | ---: | ---: |
| exact | yes | yes | 0 | 0.0% |
| exact | yes | no | 0 | 0.0% |
| exact | no | yes | 3 | 0.4% |
| exact | no | no | 15 | 1.8% |
| search | yes | yes | 46 | 5.5% |
| search | yes | no | 110 | 13.1% |
| search | no | yes | 52 | 6.2% |
| search | no | no | 292 | 34.8% |
| heuristic | yes | yes | 44 | 5.2% |
| heuristic | yes | no | 97 | 11.5% |
| heuristic | no | yes | 14 | 1.7% |
| heuristic | no | no | 167 | 19.9% |
| overall | all | all | 840 | 100.0% |

## Resolved: false value gaps

| value gap magnitude | count | percent | min | median | max |
| --- | ---: | ---: | ---: | ---: | ---: |
| 0 | 634 | 93.1% | — | — | — |
| nonzero | 47 | 6.9% | 0.01 | 1 | 11.61 |

## Rendered prose coverage

| bucket | count | percent |
| --- | ---: | ---: |
| positional | 159 | 18.9% |
| value-gap | 30 | 3.6% |
| no-difference | 651 | 77.5% |
| supported-sentence coverage | 189 | 22.5% |

| supported-sentence coverage (played != reference) | 189 | 67.5% |

## Rendered no-difference denominator breakdown

| tier | played == reference | played != reference, exactly zero | played != reference, below 0.25 | played != reference, non-reference-favoring |
| --- | ---: | ---: | ---: | ---: |
| exact | 13 | 0 | 0 | 0 |
| search | 353 | 12 | 9 | 0 |
| heuristic | 194 | 70 | 0 | 0 |
| overall | 560 | 82 | 9 | 0 |

## Eligible missKind distribution

| missKind | count |
| --- | ---: |
| correct | 560 |
| reply_risk | 104 |
| same_tile_wrong_end | 60 |
| unknown | 116 |

## Jitter measurement

Two fresh independent facts passes were compared because canonical per-record facts were not persisted.

| eligible decisions compared | 840 |
| contested flips | 4 |
| rendered top-level bucket flips | 0 |
| denominator sub-split flips | 0 |
| capped-severity flips | 0 |

## Reference-relative semantic correction

| tier | played == displayed reference | displayed-reference expected gap == 0 | positive gap below 0.25 | positive/material expected gap | expected value unavailable | sign-inconsistent/other |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| exact | 13 | 0 | 0 | 5 | 0 | 0 |
| search | 353 | 25 | 16 | 106 | 0 | 0 |
| heuristic | 193 | 0 | 0 | 0 | 129 | 0 |
| overall | 559 | 25 | 16 | 111 | 129 | 0 |

| previous zero-loss bucket-b cases | 82 |
| true displayed-reference ties from previous bucket-b cases | 12 |
| true displayed-reference ties (search) | 12 |
| true displayed-reference ties (heuristic) | 0 |
| previous bucket-b cases moved to another category | 70 |
| supported sentences (played != displayed reference) | 190/281 | 67.6% |

This is one fresh shared facts pass. Its displayed-reference denominator is 281 versus PR #285's 280, consistent with already-measured Fritz-reference jitter; 67.6% versus 67.5% is not coverage improvement attributable to this semantic correction. The 12 above are surviving ties from the old 82 bucket-b cases; the 25 in the table are all displayed-reference zero-gap decisions in this fresh pass.

## True displayed-reference equality fallback

| metric | count |
| --- | ---: |
| played != displayed reference denominator | 281 |
| positional | 162 |
| material value-gap | 30 |
| equal-value rendered | 12 |
| immediate-only supported | 0 |
| generic no-difference / unsupported | 77 |
| supported | 204/281 | 72.6% |

| remaining unsupported category | count |
| --- | ---: |
| displayed-reference value unavailable | 68 |
| positive gap below 0.25 | 9 |
| other | 0 |
