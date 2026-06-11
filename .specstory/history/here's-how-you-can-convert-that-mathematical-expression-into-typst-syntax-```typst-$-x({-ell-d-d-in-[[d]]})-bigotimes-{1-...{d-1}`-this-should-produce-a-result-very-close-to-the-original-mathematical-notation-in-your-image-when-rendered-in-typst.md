## SpecStory

## Here's how you can convert that mathematical expression into Typst syntax:

```typst
$
X({\ell_d : d \in [[D]]}) = 
\bigotimes_{1 \leq d < D} 
\left( 
\sum_{j_d \in [[r_d]]} 
\right) 
\left( 
\prod_{d \in [[D]]} C_d (j_{d-1}, \ell_d, j_d) 
\right)
$
```

This Typst code will render the mathematical expression you provided. Here's a breakdown of the key elements:

1. `\bigotimes` is used for the large tensor product symbol.
2. `\sum` is used for the summation.
3. `\prod` is used for the product.
4. `[[D]]` and `[[r_d]]` are used to represent double-bracketed sets.
5. Subscripts are denoted with `_`, e.g., `\ell_d`.
6. Multiple subscripts are grouped in parentheses, e.g., `j_{d-1}`.

This should produce a result very close to the original mathematical notation in your image when rendered in Typst. (9/15/2024, 9:49:15 PM)

_**User**_

extract convert into typst

---

_**Assistant**_

Here's how you can convert that mathematical expression into Typst syntax:

```typst
$
X({ell_d : d in [[D]]}) = 
times.big_(1 <= d < D) 
(sum_(j_d in [[r_d]]))
(product_(d in [[D]]) C_d (j_(d-1), ell_d, j_d))
$
```

This Typst code will render the mathematical expression you provided. Here's a breakdown of the key elements:

1. `times.big` is used for the large tensor product symbol
2. `sum_()` is used for the summation
3. `product_()` is used for the product
4. `[[D]]` and `[[r_d]]` are used to represent double-bracketed sets
5. Subscripts are denoted with underscore, e.g. `ell_d`
6. Multiple subscripts are grouped in parentheses, e.g. `j_(d-1)`

This should produce a result very close to the original mathematical notation in your image when rendered in Typst.

---

_**User**_

extract convert into typst

---

_**Assistant**_

Here's the conversion of the given text and equation into Typst format:

```typst
#let definition(title, content) = block(
  width: 100%,
  inset: 10pt,
  radius: 4pt,
  stroke: 0.5pt + black,
)[
  *#title.* #content
]

#definition("TT/MPS format", [
  A tensor $X in RR^(n_1 times dots.c times n_d)$ is in the TT/MPS format if there exist _core tensors_ $C_i in RR^(r_(i-1) times n_i times r_i)$ with $r_0 = r_d = 1$ such that

  $ X(ell_1, ..., ell_d) = sum_(j_1=1)^(r_1) dots.c sum_(j_(d-1)=1)^(r_(d-1)) C_1(1, ell_1, j_1) dot C_2(j_1, ell_2, j_2) dots.c C_d(j_(d-1), ell_d, 1) $

  for $ell_i = 1, ..., n_i$ and $i = 1, ..., d$. Equivalently, we have
])
```

This Typst code does the following:

1. Defines a custom `definition` function to create a boxed definition.
2. Uses this function to create the TT/MPS format definition.
3. Renders the mathematical notation using Typst's math mode.
4. Uses `dots.c` for centered dots in both the text and equation.
5. Properly formats subscripts and superscripts in the equation.
6. Uses `dot` for the multiplication dots in the equation.

When rendered, this will produce a boxed definition containing the text and equation, closely matching the format and content of the original image.

---



---

