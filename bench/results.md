# seatplan benchmarks

Node v22.23.4, linux/x64. Times are wall-clock milliseconds.

## 1. Annealing vs proven optimum

| guests | tables x seats | instances | annealing = optimum | mean anneal ms | mean exact ms | mean B&B nodes |
|---:|---|---:|---:|---:|---:|---:|
| 12 | 3 x 4 | 20 | 20/20 | 18.5 | 0.3 | 504 |
| 16 | 4 x 4 | 20 | 20/20 | 27.5 | 3.1 | 10,428 |
| 18 | 3 x 6 | 20 | 20/20 | 27.8 | 2.4 | 11,199 |
| 20 | 4 x 5 | 20 | 20/20 | 35.7 | 109.4 | 383,693 |
| 24 | 4 x 6 | 19 | 19/19 | 42.1 | 2274.4 | 6,711,231 |
| 30 | 5 x 6 | 1 | 1/1 | 57.4 | 18266.3 | 48,899,829 |

## 2. Scaling: random packing vs greedy vs annealing

Score = total happiness (higher is better), mean over 5 instances. Never-pair violations in brackets.

| guests | tables | random | greedy | annealing | anneal ms |
|---:|---:|---:|---:|---:|---:|
| 50 | 6 | 77.2 (7) | 158.8 (0) | **241.6 (0)** | 126 |
| 100 | 11 | 85.2 (2) | 263.4 (0) | **411.6 (0)** | 320 |
| 200 | 21 | 98.0 (5) | 492.2 (0) | **800.6 (0)** | 977 |
| 400 | 41 | 143.8 (6) | 937.2 (0) | **1498.2 (0)** | 3190 |
