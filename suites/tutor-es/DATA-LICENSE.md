# Data in this suite

| File | Contents | Source and license |
|---|---|---|
| `es-frequency.tsv` | rank and word form for the 5,000 most frequent Spanish word forms in film and TV subtitles (English words and names filtered out) | Derived from [FrequencyWords](https://github.com/hermitdave/FrequencyWords) by Hermit Dave (OpenSubtitles 2018), **CC BY-SA 4.0**. This derived file is shared under the same license, separately from the MIT-licensed code. |

Used by the "words above level" metric (`metrics.frequencyList` in `suite.json`): a tutor word outside the top `levelRank` forms counts as above an A1 learner's level. Only this suite uses it; the harness itself includes no data.
