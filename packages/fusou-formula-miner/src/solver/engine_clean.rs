use rand::prelude::*;

const MAX_ABS_VALUE: f64 = 1_000_000.0;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BinaryOp {
    Add,
    Sub,
    Mul,
    Div,
    Min,
    Max,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum UnaryOp {
    Identity,
    Floor,
    Exp,
    Pow,  // Power: x^2, x^3, etc. (implemented as x^0.5 for square root like behavior)
    Step, // Heaviside step: step(x) -> 1.0 if x>0 else 0.0
    Log,  // Protected logarithm: log(|x| + 1e-6)
    Sqrt, // Protected square root: sqrt(|x|)
}

#[derive(Clone, Debug)]
pub enum Expr {
    Const(f64),
    Var(usize),
    Unary {
        op: UnaryOp,
        child: Box<Expr>,
    },
    Binary {
        op: BinaryOp,
        left: Box<Expr>,
        right: Box<Expr>,
    },
}

impl Expr {
    // Calculate the size (number of nodes) in the expression tree
    pub fn size(&self) -> usize {
        match self {
            Expr::Const(_) | Expr::Var(_) => 1,
            Expr::Unary { child, .. } => 1 + child.size(),
            Expr::Binary { left, right, .. } => 1 + left.size() + right.size(),
        }
    }

    // Simplify the expression by constant folding and removing identity operations
    pub fn simplify(&self) -> Expr {
        // Structural equality for cancellation checks (exact match with small const tolerance)
        fn expr_equal(a: &Expr, b: &Expr) -> bool {
            match (a, b) {
                (Expr::Const(x), Expr::Const(y)) => (x - y).abs() < 1e-12,
                (Expr::Var(i), Expr::Var(j)) => i == j,
                (
                    Expr::Unary { op: op_a, child: ca },
                    Expr::Unary { op: op_b, child: cb },
                ) => op_a == op_b && expr_equal(ca, cb),
                (
                    Expr::Binary { op: op_a, left: la, right: ra },
                    Expr::Binary { op: op_b, left: lb, right: rb },
                ) => op_a == op_b && expr_equal(la, lb) && expr_equal(ra, rb),
                _ => false,
            }
        }

        // Collect additive terms with sign; Add/Sub are flattened
        fn collect_add_terms(expr: &Expr, sign: f64, out: &mut Vec<(Expr, f64)>) {
            match expr {
                Expr::Binary { op: BinaryOp::Add, left, right } => {
                    collect_add_terms(left, sign, out);
                    collect_add_terms(right, sign, out);
                }
                Expr::Binary { op: BinaryOp::Sub, left, right } => {
                    collect_add_terms(left, sign, out);
                    collect_add_terms(right, -sign, out);
                }
                other => out.push((other.clone(), sign)),
            }
        }

        fn rebuild_from_terms(mut terms: Vec<(Expr, f64)>) -> Expr {
            const EPS: f64 = 1e-10;
            let mut combined: Vec<(Expr, f64)> = Vec::new();
            let mut const_sum = 0.0;

            for (expr, coeff) in terms.drain(..) {
                if coeff.abs() < EPS {
                    continue;
                }
                if let Expr::Const(c) = expr {
                    const_sum += coeff * c;
                    continue;
                }
                if let Some(idx) = combined.iter().position(|(e, _)| expr_equal(e, &expr)) {
                    combined[idx].1 += coeff;
                } else {
                    combined.push((expr, coeff));
                }
            }

            combined.retain(|(_, c)| c.abs() > EPS);
            if const_sum.abs() > EPS {
                combined.push((Expr::Const(const_sum), 1.0));
            }

            if combined.is_empty() {
                return Expr::Const(0.0);
            }

            if combined.len() == 1 {
                let (expr, coeff) = combined.pop().unwrap();
                return if (coeff - 1.0).abs() < EPS {
                    expr
                } else if (coeff + 1.0).abs() < EPS {
                    Expr::Binary {
                        op: BinaryOp::Sub,
                        left: Box::new(Expr::Const(0.0)),
                        right: Box::new(expr),
                    }
                } else {
                    Expr::Binary {
                        op: BinaryOp::Mul,
                        left: Box::new(Expr::Const(coeff)),
                        right: Box::new(expr),
                    }
                };
            }

            let mut iter = combined.into_iter();
            let (first_expr, first_coeff) = iter.next().unwrap();
            let mut acc = if (first_coeff - 1.0).abs() < EPS {
                first_expr
            } else if (first_coeff + 1.0).abs() < EPS {
                Expr::Binary {
                    op: BinaryOp::Sub,
                    left: Box::new(Expr::Const(0.0)),
                    right: Box::new(first_expr),
                }
            } else {
                Expr::Binary {
                    op: BinaryOp::Mul,
                    left: Box::new(Expr::Const(first_coeff)),
                    right: Box::new(first_expr),
                }
            };

            for (expr, coeff) in iter {
                if (coeff - 1.0).abs() < EPS {
                    acc = Expr::Binary {
                        op: BinaryOp::Add,
                        left: Box::new(acc),
                        right: Box::new(expr),
                    };
                } else if (coeff + 1.0).abs() < EPS {
                    acc = Expr::Binary {
                        op: BinaryOp::Sub,
                        left: Box::new(acc),
                        right: Box::new(expr),
                    };
                } else {
                    let term = Expr::Binary {
                        op: BinaryOp::Mul,
                        left: Box::new(Expr::Const(coeff)),
                        right: Box::new(expr),
                    };
                    acc = Expr::Binary {
                        op: BinaryOp::Add,
                        left: Box::new(acc),
                        right: Box::new(term),
                    };
                }
            }

            acc
        }

        match self {
            Expr::Binary { op, left, right } => {
                let sl = left.simplify();
                let sr = right.simplify();

                // Flatten Add/Sub to cancel identical terms
                if matches!(op, BinaryOp::Add | BinaryOp::Sub) {
                    let mut terms: Vec<(Expr, f64)> = Vec::new();
                    collect_add_terms(&sl, 1.0, &mut terms);
                    let sign = if *op == BinaryOp::Add { 1.0 } else { -1.0 };
                    collect_add_terms(&sr, sign, &mut terms);
                    return rebuild_from_terms(terms);
                }
                match (op, &sl, &sr) {
                    // Constant Folding
                    (BinaryOp::Add, Expr::Const(a), Expr::Const(b)) => Expr::Const(a + b),
                    (BinaryOp::Sub, Expr::Const(a), Expr::Const(b)) => Expr::Const(a - b),
                    (BinaryOp::Mul, Expr::Const(a), Expr::Const(b)) => Expr::Const(a * b),
                    (BinaryOp::Div, Expr::Const(a), Expr::Const(b)) => {
                        // 定数割りで0割り防止
                        if b.abs() > 1e-6 {
                            Expr::Const(a / b)
                        } else {
                            // 0割りの場合は0を返す
                            Expr::Const(0.0)
                        }
                    }
                    
                    // Identity Removal: x - x = 0
                    (BinaryOp::Sub, Expr::Var(i), Expr::Var(j)) if i == j => Expr::Const(0.0),
                    
                    // Identity Removal: x + 0 = x, 0 + x = x
                    (BinaryOp::Add, x, Expr::Const(c)) if c.abs() < 1e-10 => x.clone(),
                    (BinaryOp::Add, Expr::Const(c), x) if c.abs() < 1e-10 => x.clone(),
                    
                    // Identity Removal: x - 0 = x
                    (BinaryOp::Sub, x, Expr::Const(c)) if c.abs() < 1e-10 => x.clone(),
                    
                    // Identity Removal: x * 1 = x, 1 * x = x
                    (BinaryOp::Mul, x, Expr::Const(c)) if (c - 1.0).abs() < 1e-10 => x.clone(),
                    (BinaryOp::Mul, Expr::Const(c), x) if (c - 1.0).abs() < 1e-10 => x.clone(),
                    
                    // Annihilation: x * 0 = 0, 0 * x = 0
                    (BinaryOp::Mul, _, Expr::Const(c)) | (BinaryOp::Mul, Expr::Const(c), _) if c.abs() < 1e-10 => Expr::Const(0.0),
                    
                    _ => Expr::Binary {
                        op: *op,
                        left: Box::new(sl),
                        right: Box::new(sr),
                    },
                }
            }
            Expr::Unary { op, child } => {
                let sc = child.simplify();
                match (op, &sc) {
                    // identity(x) = x - remove identity operator
                    (UnaryOp::Identity, x) => x.clone(),
                    
                    // exp(log(x)) = x
                    (UnaryOp::Exp, Expr::Unary { op: UnaryOp::Log, child: inner }) => inner.simplify(),
                    
                    // log(exp(x)) = x
                    (UnaryOp::Log, Expr::Unary { op: UnaryOp::Exp, child: inner }) => inner.simplify(),
                    
                    // Constant folding for unary operators
                    (UnaryOp::Floor, Expr::Const(c)) => Expr::Const(c.floor()),
                    (UnaryOp::Exp, Expr::Const(c)) => {
                        let result = c.clamp(-15.0, 15.0).exp();
                        Expr::Const(result)
                    }
                    (UnaryOp::Log, Expr::Const(c)) => {
                        // Protected log: log(|x| + epsilon)
                        let result = (c.abs() + 1e-6).ln();
                        Expr::Const(result)
                    }
                    (UnaryOp::Sqrt, Expr::Const(c)) => {
                        // Protected sqrt: sqrt(|x|)
                        let result = c.abs().sqrt();
                        Expr::Const(result)
                    }
                    (UnaryOp::Pow, Expr::Const(c)) => {
                        // Pow as square root in this implementation
                        let result = c.abs().powf(0.5);
                        Expr::Const(result)
                    }
                    
                    // Step constant folding
                    (UnaryOp::Step, Expr::Const(c)) => {
                        if *c > 0.0 {
                            Expr::Const(1.0)
                        } else {
                            Expr::Const(0.0)
                        }
                    }
                    
                    _ => Expr::Unary {
                        op: *op,
                        child: Box::new(sc),
                    },
                }
            }
            _ => self.clone(),
        }
    }

    pub fn eval(&self, vars: &[f64]) -> f64 {
        match self {
            Expr::Const(c) => clamp(*c),
            Expr::Var(index) => vars.get(*index).copied().unwrap_or(0.0),
            Expr::Unary { op, child } => {
                let value = child.eval(vars);
                match op {
                    UnaryOp::Identity => clamp(value),
                    UnaryOp::Floor => clamp(value.floor()),
                    UnaryOp::Exp => clamp(value.clamp(-15.0, 15.0).exp()),
                    UnaryOp::Pow => clamp(value.abs().powf(0.5)), // Square root behavior
                    UnaryOp::Step => {
                        // step関数のchildが0の場合は0を返す
                        if value == 0.0 {
                            0.0
                        } else if value > 0.0 {
                            1.0
                        } else {
                            0.0
                        }
                    }
                    UnaryOp::Log => {
                        // Protected log: log(|x| + epsilon) to avoid log(0) or log(negative)
                        clamp((value.abs() + 1e-6).ln())
                    }
                    UnaryOp::Sqrt => {
                        // Protected sqrt: sqrt(|x|) to avoid sqrt(negative)
                        clamp(value.abs().sqrt())
                    }
                }
            }
            Expr::Binary { op, left, right } => {
                let lv = left.eval(vars);
                let rv = right.eval(vars);
                let result = match op {
                    BinaryOp::Add => lv + rv,
                    BinaryOp::Sub => lv - rv,
                    BinaryOp::Mul => lv * rv,
                    BinaryOp::Div => {
                        // 右辺が0の場合は0を返す（0割り防止）
                        if rv.abs() < 1e-6 {
                            0.0
                        } else {
                            lv / rv
                        }
                    }
                    BinaryOp::Min => lv.min(rv),
                    BinaryOp::Max => lv.max(rv),
                };
                clamp(result)
            }
        }
    }

    pub fn to_string(&self, vars: &[&str]) -> String {
        match self {
            Expr::Const(c) => format!("{:.4}", c),
            Expr::Var(index) => vars.get(*index).unwrap_or(&"?").to_string(),
            Expr::Unary { op, child } => match op {
                UnaryOp::Identity => child.to_string(vars),
                UnaryOp::Floor => format!("floor({})", child.to_string(vars)),
                UnaryOp::Exp => format!("exp({})", child.to_string(vars)),
                UnaryOp::Pow => format!("sqrt({})", child.to_string(vars)),
                UnaryOp::Step => format!("step({})", child.to_string(vars)),
                UnaryOp::Log => format!("log({})", child.to_string(vars)),
                UnaryOp::Sqrt => format!("sqrt({})", child.to_string(vars)),
            },
            Expr::Binary { op, left, right } => match op {
                BinaryOp::Add => format!("({} + {})", left.to_string(vars), right.to_string(vars)),
                BinaryOp::Sub => format!("({} - {})", left.to_string(vars), right.to_string(vars)),
                BinaryOp::Mul => format!("({} * {})", left.to_string(vars), right.to_string(vars)),
                BinaryOp::Div => format!("({} / {})", left.to_string(vars), right.to_string(vars)),
                BinaryOp::Min => format!("min({}, {})", left.to_string(vars), right.to_string(vars)),
                BinaryOp::Max => format!("max({}, {})", left.to_string(vars), right.to_string(vars)),
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use crate::solver::engine_clean::*;

    fn v(i: usize) -> Expr { Expr::Var(i) }
    fn c(x: f64) -> Expr { Expr::Const(x) }

    #[test]
    fn simplify_var_minus_same_var_to_zero() {
        let expr = Expr::Binary {
            op: BinaryOp::Sub,
            left: Box::new(v(0)),
            right: Box::new(v(0)),
        };
        let s = expr.simplify();
        assert!(matches!(s, Expr::Const(z) if z.abs() < 1e-12));
    }

    #[test]
    fn simplify_add_nested_sub_cancel() {
        // a + (b - a) => b
        let expr = Expr::Binary {
            op: BinaryOp::Add,
            left: Box::new(v(0)),
            right: Box::new(Expr::Binary {
                op: BinaryOp::Sub,
                left: Box::new(v(1)),
                right: Box::new(v(0)),
            }),
        };
        let s = expr.simplify();
        assert!(matches!(s, Expr::Var(1)));
    }

    #[test]
    fn simplify_group_difference_to_zero() {
        // (x + y) - (x + y) => 0
        let expr = Expr::Binary {
            op: BinaryOp::Sub,
            left: Box::new(Expr::Binary {
                op: BinaryOp::Add,
                left: Box::new(v(0)),
                right: Box::new(v(1)),
            }),
            right: Box::new(Expr::Binary {
                op: BinaryOp::Add,
                left: Box::new(v(0)),
                right: Box::new(v(1)),
            }),
        };
        let s = expr.simplify();
        assert!(matches!(s, Expr::Const(z) if z.abs() < 1e-12));
    }

    #[test]
    fn simplify_add_negated_term() {
        // x + (-x) => 0
        let expr = Expr::Binary {
            op: BinaryOp::Add,
            left: Box::new(v(0)),
            right: Box::new(Expr::Binary {
                op: BinaryOp::Sub,
                left: Box::new(c(0.0)),
                right: Box::new(v(0)),
            }),
        };
        let s = expr.simplify();
        assert!(matches!(s, Expr::Const(z) if z.abs() < 1e-12));
    }
}

#[derive(Clone, Copy, Debug)]
pub struct GeneticConfig {
    pub population_size: usize,
    pub max_depth: usize,
    pub mutation_rate: f64,
    pub crossover_rate: f64,
    pub tournament_size: usize,
    pub elite_count: usize,
    pub max_attempts: usize,  // Number of times to retry GA if target not reached
    pub use_nsga2: bool,      // Use NSGA-II multi-objective optimization
    pub tarpeian_probability: f64,  // Probability of applying Tarpeian penalty (0.5 recommended)
    pub hoist_mutation_rate: f64,   // Probability of applying hoist mutation (0.1 recommended)
    pub constant_optimization_interval: usize,  // Optimize constants every N generations (0 = disabled)
    pub duplicate_penalty: f64, // Relative penalty applied to RMSE for duplicate expressions (e.g., 0.2 => +20%)
}

impl Default for GeneticConfig {
    fn default() -> Self {
        Self {
            population_size: 128,
            max_depth: 6,
            mutation_rate: 0.2,
            crossover_rate: 0.8,
            tournament_size: 3,
            elite_count: 4,
            max_attempts: 5,  // Default: try up to 5 times
            use_nsga2: true,  // Enable multi-objective optimization by default
            tarpeian_probability: 0.5,  // 50% chance to punish oversized individuals
            hoist_mutation_rate: 0.1,   // 10% chance of hoist mutation
            constant_optimization_interval: 10,  // Optimize constants every 10 generations
            duplicate_penalty: 0.2, // default 20% penalty for duplicates
        }
    }
}

pub fn random_expr<R: Rng + ?Sized>(rng: &mut R, max_depth: usize, num_vars: usize, counts: &mut std::collections::HashMap<&'static str, usize>) -> Expr {
    if max_depth == 0 {
        return random_leaf(rng, num_vars);
    }

    // Decide whether to create an operator node or a leaf.
    // Keep the original operator vs leaf ratio (3/5 operators, 2/5 leaves),
    // but when an operator is chosen, pick uniformly among all operators
    // (both binary and unary) so each operator's occurrence probability is
    // roughly equal.
    match rng.gen_range(0..5) {
        0 | 1 | 2 => {
            // There are 6 binary ops and 6 unary ops (identity removed, total 12).
            let total_ops = 12;
            let op_idx = rng.gen_range(0..total_ops);
            if op_idx < 6 {
                // binary operator
                let op = match op_idx {
                    0 => BinaryOp::Add,
                    1 => BinaryOp::Sub,
                    2 => BinaryOp::Mul,
                    3 => BinaryOp::Div,
                    4 => BinaryOp::Min,
                    _ => BinaryOp::Max,
                };
                match op {
                    BinaryOp::Add => *counts.entry("+").or_insert(0) += 1,
                    BinaryOp::Sub => *counts.entry("-").or_insert(0) += 1,
                    BinaryOp::Mul => *counts.entry("*").or_insert(0) += 1,
                    BinaryOp::Div => *counts.entry("/").or_insert(0) += 1,
                    BinaryOp::Min => *counts.entry("min").or_insert(0) += 1,
                    BinaryOp::Max => *counts.entry("max").or_insert(0) += 1,
                }
                Expr::Binary {
                    op,
                    left: Box::new(random_expr(rng, max_depth - 1, num_vars, counts)),
                        right: Box::new(random_expr(rng, max_depth - 1, num_vars, counts)),
                }
            } else {
                // unary operator (identity excluded)
                let u_idx = op_idx - 6;
                let op = match u_idx {
                    0 => UnaryOp::Floor,
                    1 => UnaryOp::Exp,
                    2 => UnaryOp::Pow,
                    3 => UnaryOp::Step,
                    4 => UnaryOp::Log,
                    _ => UnaryOp::Sqrt,
                };
                match op {
                    UnaryOp::Floor => *counts.entry("floor").or_insert(0) += 1,
                    UnaryOp::Exp => *counts.entry("exp").or_insert(0) += 1,
                    UnaryOp::Pow => *counts.entry("pow").or_insert(0) += 1,
                    UnaryOp::Step => *counts.entry("step").or_insert(0) += 1,
                    UnaryOp::Log => *counts.entry("log").or_insert(0) += 1,
                    UnaryOp::Sqrt => *counts.entry("sqrt").or_insert(0) += 1,
                    _ => {}
                }
                Expr::Unary {
                    op,
                    child: Box::new(random_expr(rng, max_depth - 1, num_vars, counts)),
                }
            }
        }
        _ => random_leaf(rng, num_vars),
    }
}

pub fn mutate<R: Rng + ?Sized>(expr: &Expr, rng: &mut R, num_vars: usize, max_depth: usize, counts: &mut std::collections::HashMap<&'static str, usize>) -> Expr {
    // Increased mutation rate from 0.15 to 0.3 to better escape local optima and reduce overfitting
    if rng.gen_bool(0.3) {
        return random_expr(rng, max_depth.saturating_sub(1), num_vars, counts).simplify();
    }

    let mut out = expr.clone();
    let target = random_subexpr_mut(&mut out, rng);

    match target {
            Expr::Const(ref mut v) => {
            *v = clamp(*v + rng.gen_range(-1.0..1.0));
        }
        Expr::Var(ref mut idx) => {
            if num_vars > 0 {
                *idx = rng.gen_range(0..num_vars);
            } else {
                *target = Expr::Const(random_constant(rng));
            }
        }
            Expr::Unary { op, child } => {
            if rng.gen_bool(0.4) {
                *op = random_unary_op(rng);
                match op {
                    UnaryOp::Floor => *counts.entry("floor").or_insert(0) += 1,
                    UnaryOp::Exp => *counts.entry("exp").or_insert(0) += 1,
                    UnaryOp::Pow => *counts.entry("pow").or_insert(0) += 1,
                    UnaryOp::Step => *counts.entry("step").or_insert(0) += 1,
                    UnaryOp::Log => *counts.entry("log").or_insert(0) += 1,
                    UnaryOp::Sqrt => *counts.entry("sqrt").or_insert(0) += 1,
                    _ => {}
                }
            } else {
                **child = random_expr(rng, (max_depth / 2).max(1), num_vars, counts);
            }
        }
        Expr::Binary { op, left, right } => {
            if rng.gen_bool(0.3) {
                *op = random_binary_op(rng);
                match op {
                    BinaryOp::Add => *counts.entry("+").or_insert(0) += 1,
                    BinaryOp::Sub => *counts.entry("-").or_insert(0) += 1,
                    BinaryOp::Mul => *counts.entry("*").or_insert(0) += 1,
                    BinaryOp::Div => *counts.entry("/").or_insert(0) += 1,
                    BinaryOp::Min => *counts.entry("min").or_insert(0) += 1,
                    BinaryOp::Max => *counts.entry("max").or_insert(0) += 1,
                }
            }
            if rng.gen_bool(0.5) {
                **left = random_expr(rng, (max_depth / 2).max(1), num_vars, counts);
            } else {
                **right = random_expr(rng, (max_depth / 2).max(1), num_vars, counts);
            }
        }
    }

    // Simplify the result to reduce bloat
    out.simplify()
}

pub fn crossover<R: Rng + ?Sized>(lhs: &Expr, rhs: &Expr, rng: &mut R, counts: &mut std::collections::HashMap<&'static str, usize>) -> Expr {
    if rng.gen_bool(0.1) {
        return rhs.simplify();
    }

    let donor = random_subexpr(rhs, rng).clone();
    // Count operators present in donor subtree as crossover events
    incr_counts_from_expr(&donor, counts);
    let mut child = lhs.clone();
    let target = random_subexpr_mut(&mut child, rng);
    *target = donor;
    // Simplify the child to reduce bloat from crossover
    child.simplify()
}

fn incr_counts_from_expr(expr: &Expr, counts: &mut std::collections::HashMap<&'static str, usize>) {
    match expr {
        Expr::Const(_) | Expr::Var(_) => {}
        Expr::Unary { op, child } => {
            match op {
                UnaryOp::Floor => *counts.entry("floor").or_insert(0) += 1,
                UnaryOp::Exp => *counts.entry("exp").or_insert(0) += 1,
                UnaryOp::Pow => *counts.entry("pow").or_insert(0) += 1,
                UnaryOp::Step => *counts.entry("step").or_insert(0) += 1,
                UnaryOp::Log => *counts.entry("log").or_insert(0) += 1,
                UnaryOp::Sqrt => *counts.entry("sqrt").or_insert(0) += 1,
                _ => {}
            }
            incr_counts_from_expr(child, counts);
        }
        Expr::Binary { op, left, right } => {
            match op {
                BinaryOp::Add => *counts.entry("+").or_insert(0) += 1,
                BinaryOp::Sub => *counts.entry("-").or_insert(0) += 1,
                BinaryOp::Mul => *counts.entry("*").or_insert(0) += 1,
                BinaryOp::Div => *counts.entry("/").or_insert(0) += 1,
                BinaryOp::Min => *counts.entry("min").or_insert(0) += 1,
                BinaryOp::Max => *counts.entry("max").or_insert(0) += 1,
            }
            incr_counts_from_expr(left, counts);
            incr_counts_from_expr(right, counts);
        }
    }
}

fn random_leaf<R: Rng + ?Sized>(rng: &mut R, num_vars: usize) -> Expr {
    if num_vars > 0 && rng.gen_bool(0.6) {
        Expr::Var(rng.gen_range(0..num_vars))
    } else {
        Expr::Const(random_constant(rng))
    }
}

fn random_constant<R: Rng + ?Sized>(rng: &mut R) -> f64 {
    let base = rng.gen_range(-5.0..5.0);
    let jitter = rng.gen_range(-0.25..0.25);
    clamp(base + jitter)
}

fn random_binary_op<R: Rng + ?Sized>(rng: &mut R) -> BinaryOp {
    match rng.gen_range(0..6) {
        0 => BinaryOp::Add,
        1 => BinaryOp::Sub,
        2 => BinaryOp::Mul,
        3 => BinaryOp::Div,
        4 => BinaryOp::Min,
        _ => BinaryOp::Max,
    }
}

fn random_unary_op<R: Rng + ?Sized>(rng: &mut R) -> UnaryOp {
    match rng.gen_range(0..6) {
        0 => UnaryOp::Floor,
        1 => UnaryOp::Exp,
        2 => UnaryOp::Pow,
        3 => UnaryOp::Step,
        4 => UnaryOp::Log,
        _ => UnaryOp::Sqrt,
    }
}

fn random_subexpr<'a, R: Rng + ?Sized>(expr: &'a Expr, rng: &mut R) -> &'a Expr {
    let mut node = expr;
    loop {
        match node {
            Expr::Binary { left, right, .. } => match rng.gen_range(0..3) {
                0 => return node,
                1 => node = left,
                _ => node = right,
            },
            Expr::Unary { child, .. } => {
                if rng.gen_bool(0.5) {
                    return node;
                }
                node = child;
            }
            _ => return node,
        }
    }
}

fn random_subexpr_mut<'a, R: Rng + ?Sized>(expr: &'a mut Expr, rng: &mut R) -> &'a mut Expr {
    if matches!(expr, Expr::Const(_) | Expr::Var(_)) || rng.gen_bool(0.3) {
        return expr;
    }

    match expr {
        Expr::Binary { left, right, .. } => {
            if rng.gen_bool(0.5) {
                random_subexpr_mut(left, rng)
            } else {
                random_subexpr_mut(right, rng)
            }
        }
        Expr::Unary { child, .. } => random_subexpr_mut(child, rng),
        _ => expr,
    }
}

fn clamp(value: f64) -> f64 {
    value.clamp(-MAX_ABS_VALUE, MAX_ABS_VALUE)
}
