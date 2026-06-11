## SpecStory

## Epidemiology and Ecology Data Analysis (9/17/2024, 1:56:42 PM)

_**User**_

In epidemiology and ecology, understanding the interactions within and between populations is crucial.
We will explore this with the aid of some data from the literature. We will first consider the pioneering
work of Elton and Nicholson (1942), where they reported data on the populations of snowshoe hares and
lynx in Canada. The data, covering the period from 1848 to 1907, is presented in Table 1.
2 Assignment Instructions
Use  Python to perform the following tasks:
2.1 Task 1: Plot the Data
Type the model for this data. (1 mark).
2.2 Task 2: Phase Plane Analysis
Use MATLAB or Python to optimize the parameters of the model with the aid of the data. (2 mark).
2.3 Task 3
Plot the results, the data and the optimized model’s results. (1 mark).

---

_**Assistant**_

# Task 1: Plot the Data and Define the Model

We begin by reading the provided data and plotting the populations of snowshoe hares and lynx over time. We will use the Lotka-Volterra equations to model the predator-prey dynamics between hares (prey) and lynx (predators).

## Code to Read and Plot the Data

```python:/path/to/plot_data.py
import pandas as pd
import matplotlib.pyplot as plt

# Read the data from the CSV file
data = pd.read_csv('/Users/f/data.txt')

# Plot the hare and lynx populations over time
plt.figure(figsize=(10, 6))
plt.plot(data['Year'], data['Hares (thousands)'], label='Hares')
plt.plot(data['Year'], data['Lynx (thousands)'], label='Lynx')
plt.xlabel('Year')
plt.ylabel('Population (thousands)')
plt.title('Snowshoe Hare and Lynx Populations (1848-1907)')
plt.legend()
plt.grid(True)
plt.show()
```

**Lotka-Volterra Model Equations:**

The Lotka-Volterra equations describe the dynamics of predator-prey interactions:

\[
\begin{align*}
\frac{dx}{dt} &= \alpha x - \beta x y \\
\frac{dy}{dt} &= \delta x y - \gamma y
\end{align*}
\]

- \( x \): Population of hares (prey)
- \( y \): Population of lynx (predators)
- \( \alpha \): Natural growth rate of hares without predation
- \( \beta \): Death rate of hares due to predation
- \( \gamma \): Natural death rate of lynx without food (hares)
- \( \delta \): Efficiency of turning consumed hares into lynx offspring

# Task 2: Phase Plane Analysis and Parameter Optimization

We will optimize the parameters \( \alpha, \beta, \gamma, \delta \) of the Lotka-Volterra model to fit the historical data using nonlinear least squares optimization. Then, we'll perform a phase plane analysis to visualize the dynamics.

## Code for Parameter Optimization and Phase Plane Analysis

```python:/path/to/parameter_optimization.py
import numpy as np
from scipy.integrate import odeint
from scipy.optimize import least_squares
import matplotlib.pyplot as plt

# Extract time and population data
years = data['Year'].values
t = years - years[0]  # Normalize time to start from 0
hares = data['Hares (thousands)'].values
lynx = data['Lynx (thousands)'].values

# Initial guesses for parameters
params_initial = [0.5, 0.02, 0.4, 0.02]  # [alpha, beta, gamma, delta]

# Lotka-Volterra model function
def lotka_volterra(X, t, params):
    x, y = X
    alpha, beta, gamma, delta = params
    dxdt = alpha * x - beta * x * y
    dydt = delta * x * y - gamma * y
    return [dxdt, dydt]

# Objective function to minimize
def objective(params):
    # Integrate the ODEs
    sol = odeint(lotka_volterra, [hares[0], lynx[0]], t, args=(params,))
    x_model, y_model = sol.T
    # Compute residuals
    residuals = np.concatenate([x_model - hares, y_model - lynx])
    return residuals

# Optimize parameters
result = least_squares(objective, params_initial, bounds=(0, np.inf))
alpha_opt, beta_opt, gamma_opt, delta_opt = result.x
print(f'Optimized parameters:\nalpha = {alpha_opt:.4f}, beta = {beta_opt:.4f}, gamma = {gamma_opt:.4f}, delta = {delta_opt:.4f}')

# Phase Plane Analysis
x_vals = np.linspace(0, max(hares)*1.1, 20)
y_vals = np.linspace(0, max(lynx)*1.1, 20)
X, Y = np.meshgrid(x_vals, y_vals)
U = alpha_opt * X - beta_opt * X * Y
V = delta_opt * X * Y - gamma_opt * Y

plt.figure(figsize=(8, 6))
plt.streamplot(X, Y, U, V, density=1.0, linewidth=1, arrowsize=1, arrowstyle='->')
plt.xlabel('Hares Population (thousands)')
plt.ylabel('Lynx Population (thousands)')
plt.title('Phase Plane of Hare and Lynx Populations')
plt.grid(True)
plt.show()
```

# Task 3: Plot the Results

We compare the optimized model's predictions with the actual data by plotting them together.

## Code to Plot the Model Results with the Data

```python:/path/to/plot_model_vs_data.py
# Integrate the ODEs using optimized parameters
solution = odeint(lotka_volterra, [hares[0], lynx[0]], t, args=([alpha_opt, beta_opt, gamma_opt, delta_opt],))
hares_model, lynx_model = solution.T

# Plot the data and model predictions
plt.figure(figsize=(10, 6))
plt.plot(years, hares, 'bo', label='Hares Data')
plt.plot(years, lynx, 'ro', label='Lynx Data')
plt.plot(years, hares_model, 'b-', label='Hares Model')
plt.plot(years, lynx_model, 'r-', label='Lynx Model')
plt.xlabel('Year')
plt.ylabel('Population (thousands)')
plt.title('Comparison of Data and Model Predictions')
plt.legend()
plt.grid(True)
plt.show()
```

---

**Explanation:**

- **Task 1:** We read the data using `pandas` and plot the hare and lynx populations over time using `matplotlib`. The Lotka-Volterra model equations are provided to describe the predator-prey dynamics.

- **Task 2:** We use `scipy.optimize.least_squares` to optimize the parameters of the Lotka-Volterra model. The objective function computes the residuals between the model outputs and the actual data. We perform phase plane analysis by plotting the vector field using `streamplot`.

- **Task 3:** We plot the model predictions along with the actual data to visualize how well the optimized model fits the data.

---

**References:**

- [Lotka-Volterra equations](https://en.wikipedia.org/wiki/Lotka–Volterra_equations)
- [scipy.integrate.odeint](https://docs.scipy.org/doc/scipy/reference/generated/scipy.integrate.odeint.html)
- [scipy.optimize.least_squares](https://docs.scipy.org/doc/scipy/reference/generated/scipy.optimize.least_squares.html)
- [Matplotlib Streamplot](https://matplotlib.org/stable/api/_as_gen/matplotlib.pyplot.streamplot.html)

---

_**User**_

excellent translate all into matlab code

---

_**Assistant**_

# Task 1: Plot the Data and Define the Model

We start by reading the provided data and plotting the populations of snowshoe hares and lynx over time. We will use the Lotka-Volterra equations to model the predator-prey dynamics between hares (prey) and lynx (predators).

## Code to Read and Plot the Data

```matlab:/path/to/plot_data.m
% Function to read and plot the hare and lynx data
function plot_hare_lynx_data()
    % Read the data from the text file
    data = readtable('/Users/f/data.txt');
    
    % Extract the data
    years = data.Year;
    hares = data.Hares_thousands_;
    lynx = data.Lynx_thousands_;
    
    % Plot the hare and lynx populations over time
    figure;
    plot(years, hares, 'b-', 'LineWidth', 2);
    hold on;
    plot(years, lynx, 'r-', 'LineWidth', 2);
    xlabel('Year');
    ylabel('Population (thousands)');
    title('Snowshoe Hare and Lynx Populations (1848-1907)');
    legend('Hares', 'Lynx');
    grid on;
    hold off;
end
```

**Lotka-Volterra Model Equations:**

The Lotka-Volterra equations describe the dynamics of predator-prey interactions:

\[
\begin{align*}
\frac{dx}{dt} &= \alpha x - \beta x y \\
\frac{dy}{dt} &= \delta x y - \gamma y
\end{align*}
\]

- \( x \): Population of hares (prey)
- \( y \): Population of lynx (predators)
- \( \alpha \): Natural growth rate of hares without predation
- \( \beta \): Death rate of hares due to predation
- \( \gamma \): Natural death rate of lynx without food (hares)
- \( \delta \): Efficiency of turning consumed hares into lynx offspring

# Task 2: Phase Plane Analysis and Parameter Optimization

We will optimize the parameters \( \alpha, \beta, \gamma, \delta \) of the Lotka-Volterra model to fit the historical data using nonlinear least squares optimization. Then, we'll perform a phase plane analysis to visualize the dynamics.

## Code for Parameter Optimization and Phase Plane Analysis

```matlab:/path/to/parameter_optimization.m
% Function to optimize parameters and perform phase plane analysis
function parameter_optimization()
    % Read the data from the text file
    data = readtable('/Users/f/data.txt');
    
    % Extract time and population data
    years = data.Year;
    t = years - years(1); % Normalize time to start from 0
    hares = data.Hares_thousands_;
    lynx = data.Lynx_thousands_;
    
    % Initial guesses for parameters
    params_initial = [0.5; 0.02; 0.4; 0.02]; % [alpha; beta; gamma; delta]
    
    % Lotka-Volterra model function
    function dXdt = lotka_volterra(t, X, params)
        x = X(1);
        y = X(2);
        alpha = params(1);
        beta = params(2);
        gamma = params(3);
        delta = params(4);
        dxdt = alpha * x - beta * x * y;
        dydt = delta * x * y - gamma * y;
        dXdt = [dxdt; dydt];
    end

    % Objective function to minimize
    function residuals = objective(params)
        % Integrate the ODEs
        [t_out, sol] = ode45(@(t, X) lotka_volterra(t, X, params), t, [hares(1); lynx(1)]);
        x_model = interp1(t_out, sol(:,1), t);
        y_model = interp1(t_out, sol(:,2), t);
        % Compute residuals
        residuals = [x_model - hares; y_model - lynx];
    end

    % Optimize parameters
    options = optimoptions('lsqnonlin', 'Display', 'iter');
    params_optimized = lsqnonlin(@objective, params_initial, zeros(4,1), [], options);
    alpha_opt = params_optimized(1);
    beta_opt = params_optimized(2);
    gamma_opt = params_optimized(3);
    delta_opt = params_optimized(4);
    fprintf('Optimized parameters:\n');
    fprintf('alpha = %.4f\nbeta = %.4f\ngamma = %.4f\ndelta = %.4f\n', alpha_opt, beta_opt, gamma_opt, delta_opt);
    
    % Phase Plane Analysis
    x_vals = linspace(0, max(hares)*1.1, 20);
    y_vals = linspace(0, max(lynx)*1.1, 20);
    [X_mesh, Y_mesh] = meshgrid(x_vals, y_vals);
    U = alpha_opt * X_mesh - beta_opt * X_mesh .* Y_mesh;
    V = delta_opt * X_mesh .* Y_mesh - gamma_opt * Y_mesh;
    
    figure;
    quiver(X_mesh, Y_mesh, U, V, 'AutoScale', 'on');
    xlabel('Hares Population (thousands)');
    ylabel('Lynx Population (thousands)');
    title('Phase Plane of Hare and Lynx Populations');
    grid on;
end
```

# Task 3: Plot the Results

We compare the optimized model's predictions with the actual data by plotting them together.

## Code to Plot the Model Results with the Data

```matlab:/path/to/plot_model_vs_data.m
% Function to plot the data and model predictions
function plot_model_vs_data()
    % Read the data from the text file
    data = readtable('/Users/f/data.txt');
    
    % Extract time and population data
    years = data.Year;
    t = years - years(1); % Normalize time to start from 0
    hares = data.Hares_thousands_;
    lynx = data.Lynx_thousands_;
    
    % Optimized parameters from previous task (insert actual values)
    alpha_opt = 0.5; % Replace with optimized value
    beta_opt = 0.02; % Replace with optimized value
    gamma_opt = 0.4; % Replace with optimized value
    delta_opt = 0.02; % Replace with optimized value

    % Lotka-Volterra model function
    function dXdt = lotka_volterra(t, X)
        x = X(1);
        y = X(2);
        dxdt = alpha_opt * x - beta_opt * x * y;
        dydt = delta_opt * x * y - gamma_opt * y;
        dXdt = [dxdt; dydt];
    end

    % Integrate the ODEs using optimized parameters
    [t_out, sol] = ode45(@lotka_volterra, t, [hares(1); lynx(1)]);
    x_model = interp1(t_out, sol(:,1), t);
    y_model = interp1(t_out, sol(:,2), t);

    % Plot the data and model predictions
    figure;
    plot(years, hares, 'bo', 'LineWidth', 1.5);
    hold on;
    plot(years, lynx, 'ro', 'LineWidth', 1.5);
    plot(years, x_model, 'b-', 'LineWidth', 2);
    plot(years, y_model, 'r-', 'LineWidth', 2);
    xlabel('Year');
    ylabel('Population (thousands)');
    title('Comparison of Data and Model Predictions');
    legend('Hares Data', 'Lynx Data', 'Hares Model', 'Lynx Model');
    grid on;
    hold off;
end
```

---

**Explanation:**

- **Task 1:** We read the data using `readtable` and plot the hare and lynx populations over time using MATLAB's plotting functions. The Lotka-Volterra model equations are provided to describe the predator-prey dynamics.

- **Task 2:** We use `lsqnonlin` to optimize the parameters of the Lotka-Volterra model. The objective function computes the residuals between the model outputs and the actual data. We perform phase plane analysis by plotting the vector field using `quiver`.

- **Task 3:** We plot the model predictions along with the actual data to visualize how well the optimized model fits the data.

---

**References:**

- [Lotka-Volterra Equations](https://en.wikipedia.org/wiki/Lotka–Volterra_equations)
- [MATLAB `ode45` Documentation](https://www.mathworks.com/help/matlab/ref/ode45.html)
- [MATLAB `lsqnonlin` Documentation](https://www.mathworks.com/help/optim/ug/lsqnonlin.html)
- [MATLAB `quiver` Function](https://www.mathworks.com/help/matlab/ref/quiver.html)

---



---

