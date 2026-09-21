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
