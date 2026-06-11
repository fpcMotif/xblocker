## SpecStory

## Fixing the "unknown variable: bigotimes" error in code. (9/15/2024, 9:50:51 PM)

_**User**_

For the code present, we get this error:
```
unknown variable: bigotimes
```
How can I resolve this? If you propose a fix, please make it concise.

---

_**Assistant**_

To resolve the error, you can replace `bigotimes` with `times.big`, which is the Typst equivalent for a large product symbol. Here's the corrected version:

```typst
$
X({l_d : d in [[D]]}) = times.big_(1 <= d < D) (sum_(j_d in [[r_d]])) (prod_(d in [[D]]) C_d(j_(d-1), l_d, j_d))
$
```

This should resolve the "unknown variable: bigotimes" error.

---



---

