# seatplan benchmarks

Node v22.23.4, linux/x64. Times are wall-clock milliseconds.

## 1. Annealing vs proven optimum

| guests | tables x seats | instances | annealing = optimum | mean anneal ms | mean exact ms | mean B&B nodes |
|---:|---|---:|---:|---:|---:|---:|
| 12 | 3 x 4 | 20 | 20/20 | 20.1 | 0.3 | 504 |
| 16 | 4 x 4 | 20 | 20/20 | 26.4 | 3.0 | 10,428 |
| 18 | 3 x 6 | 20 | 20/20 | 30.2 | 2.8 | 11,199 |
| 20 | 4 x 5 | 20 | 20/20 | 37.3 | 121.1 | 383,693 |
| 24 | 4 x 6 | 19 | 19/19 | 43.2 | 2326.0 | 6,711,231 |

## 2. Scaling: random packing vs greedy vs annealing

Score = total happiness (higher is better), mean over 5 instances. Never-pair violations in brackets.

| guests | tables | random | greedy | annealing | anneal ms |
|---:|---:|---:|---:|---:|---:|
| 50 | 6 | 77.2 (7) | 158.8 (0) | **241.6 (0)** | 125 |
| 100 | 11 | 85.2 (2) | 263.4 (0) | **411.6 (0)** | 332 |
| 200 | 21 | 98.0 (5) | 492.2 (0) | **800.6 (0)** | 967 |
| 400 | 41 | 143.8 (6) | 937.2 (0) | **1498.2 (0)** | 3212 |
