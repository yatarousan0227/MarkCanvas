# MarkCanvas Math Sample

このファイルは数式入力と round-trip 確認用の Markdown サンプルです。

## Inline Math

Energy equation: $E = mc^2$

Quadratic formula: $x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}$

Matrix notation: $A \in \mathbb{R}^{m \times n}$

## Block Math

$$
\int_0^1 x^2 \, dx = \frac{1}{3}
$$

$$
\sum_{k=1}^{n} k = \frac{n(n+1)}{2}
$$

$$
\begin{bmatrix}
1 & 2 \\
3 & 4
\end{bmatrix}
$$

## Mixed Markdown

1. Inline math in a list: $f(x) = x^2 + 1$
2. Another one: $\alpha + \beta + \gamma$

> Block quote with math: $\nabla \cdot \vec{E} = \frac{\rho}{\varepsilon_0}$

| name | expression |
| ---- | ---------- |
| area | $A = \pi r^2$ |
| wave | $\lambda = \frac{v}{f}$ |

## Editing Checks

- Select plain text and convert it to inline math.
- Insert a block math node from the toolbar.
- Edit the formula, save, and reopen to confirm the Markdown is preserved.
