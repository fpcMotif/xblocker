## SpecStory

## Here’s the content converted into Typst format:

#heading(level: 1)[8. Representation of the Encoding and Decoding Operations]

We have yet to represent mathematically the operations performed by the transmitter and receiver in encoding and decoding the information. Either of these will be called a discrete transducer. The input to the transducer is a sequence of input symbols and its output a sequence of output symbols. The transducer may have an internal memory so that its output depends not only on the present input symbol but also on the past history. We assume that the internal memory is finite, i.e., there exist a finite number $m$ of possible states of the transducer and that its output is a function of the present state and the present input symbol. The next state will be a second function of these two quantities. Thus a transducer can be described by two functions:

$ y_n = f(x_n, \alpha_n) $
$ \alpha_{n+1} = g(x_n, \alpha_n) $

where

- $x_n$ is the $n$th input symbol,
- $\alpha_n$ is the state of the transducer when the $n$th input symbol is introduced,
- $y_n$ is the output symbol (or sequence of output symbols) produced when $x_n$ is introduced if the state is $\alpha_n$.

If the output symbols of one transducer can be identified with the input symbols of a second, they can be connected in tandem and the result is also a transducer. If there exists a second transducer which operates on the output of the first and recovers the original input, the first transducer will be called non-singular and the second will be called its inverse.

#theorem(title: "Theorem 7")[
  The output of a finite state transducer driven by a finite state statistical source is a finite state statistical source, with entropy (per unit time) less than or equal to that of the input. If the transducer is non-singular they are equal.
]

Let $\alpha$ represent the state of the source, which produces a sequence of symbols $x_i$; and let $\beta$ be the state of the transducer, which produces, in its output, blocks of symbols $y_j$. The combined system can be represented by the "product state space" of pairs $(\alpha, \beta)$. Two points in the space $(\alpha_1, \beta_1)$ and $(\alpha_2, \beta_2)$, are connected by a line if $\alpha_1$ can produce an $x$ which changes $\beta_1$ to $\beta_2$, and this line is given the probability of that $x$ in this case. The line is labeled with the block of $y_j$ symbols produced by the transducer. The entropy of the output can be calculated as the weighted sum over the states. If we sum first on $\beta$ each resulting term is less than or equal to the corresponding term for $\alpha$, hence the entropy is not increased. If the transducer is non-singular let its output be connected to the inverse transducer. If $H_1', H_2'$ and $H_3'$ are the output entropies of the source, the first and second transducers respectively, then $H_1' \geq H_2' \geq H_3' = H_1'$ and therefore $H_1' = H_2'$. (9/16/2024, 4:18:16 AM)

_**User**_

reconzie and convert into typst

---

_**Assistant**_

Here's the content converted into Typst format:

#heading(level: 1)[8. Representation of the Encoding and Decoding Operations]

We have yet to represent mathematically the operations performed by the transmitter and receiver in encoding and decoding the information. Either of these will be called a discrete transducer. The input to the transducer is a sequence of input symbols and its output a sequence of output symbols. The transducer may have an internal memory so that its output depends not only on the present input symbol but also on the past history. We assume that the internal memory is finite, i.e., there exist a finite number $m$ of possible states of the transducer and that its output is a function of the present state and the present input symbol. The next state will be a second function of these two quantities. Thus a transducer can be described by two functions:

$ y_n = f(x_n, alpha_n) $
$ alpha_(n+1) = g(x_n, alpha_n) $

where

- $x_n$ is the $n$th input symbol,
- $alpha_n$ is the state of the transducer when the $n$th input symbol is introduced,
- $y_n$ is the output symbol (or sequence of output symbols) produced when $x_n$ is introduced if the state is $alpha_n$.

If the output symbols of one transducer can be identified with the input symbols of a second, they can be connected in tandem and the result is also a transducer. If there exists a second transducer which operates on the output of the first and recovers the original input, the first transducer will be called non-singular and the second will be called its inverse.

#theorem(title: "Theorem 7")[
  The output of a finite state transducer driven by a finite state statistical source is a finite state statistical source, with entropy (per unit time) less than or equal to that of the input. If the transducer is non-singular they are equal.
]

Let $alpha$ represent the state of the source, which produces a sequence of symbols $x_i$; and let $beta$ be the state of the transducer, which produces, in its output, blocks of symbols $y_j$. The combined system can be represented by the "product state space" of pairs $(alpha, beta)$. Two points in the space $(alpha_1, beta_1)$ and $(alpha_2, beta_2)$, are connected by a line if $alpha_1$ can produce an $x$ which changes $beta_1$ to $beta_2$, and this line is given the probability of that $x$ in this case. The line is labeled with the block of $y_j$ symbols produced by the transducer. The entropy of the output can be calculated as the weighted sum over the states. If we sum first on $beta$ each resulting term is less than or equal to the corresponding term for $alpha$, hence the entropy is not increased. If the transducer is non-singular let its output be connected to the inverse transducer. If $H_1', H_2'$ and $H_3'$ are the output entropies of the source, the first and second transducers respectively, then $H_1' >= H_2' >= H_3' = H_1'$ and therefore $H_1' = H_2'$.

---



---

