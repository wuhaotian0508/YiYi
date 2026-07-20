# Before / after

| Measured issue | Before | After |
|---|---:|---:|
| Dev Calibration Lab in production graph | real component + 3 entry chunks (395,087 raw bytes) | real component/chunks absent; route 404 |
| CSS paid by every route | 51,881 bytes | 47,064 bytes (-4,817 / -9.3%); Swiper CSS only on Today |
| Production review instrumentation matches | 0 | 0 |
| Outfit targeted replacement | unrecorded | one React update commit; 0.277 ms local actualDuration |
| Motion WebKit suite | 7 pass | 7 pass |

Whole-build JS bytes moved from 3,209,661 to 3,217,173 (+0.23%) after the
release trust/correlation checks and Turbopack re-chunking; it is within the RC
baseline and is not presented as an improvement. Route ownership and entry graphs
are the stable evidence.
