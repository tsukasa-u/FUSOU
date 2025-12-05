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

#[derive(Clone, Copy, Debug)]
pub struct GeneticConfig {
    pub population_size: usize,
    pub max_depth: usize,
    pub mutation_rate: f64,
    pub crossover_rate: f64,
    pub tournament_size: usize,
    pub elite_count: usize,
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
        }
    }
}

pub fn random_expr<R: Rng + ?Sized>(rng: &mut R, max_depth: usize, num_vars: usize) -> Expr {
    if max_depth == 0 {
        return random_leaf(rng, num_vars);
    }

    match rng.gen_range(0..5) {
        0 | 1 => Expr::Binary {
            op: random_binary_op(rng),
            left: Box::new(random_expr(rng, max_depth - 1, num_vars)),
            right: Box::new(random_expr(rng, max_depth - 1, num_vars)),
        },
        2 => Expr::Unary {
            op: random_unary_op(rng),
            child: Box::new(random_expr(rng, max_depth - 1, num_vars)),
        },
        _ => random_leaf(rng, num_vars),
    }
}

pub fn mutate<R: Rng + ?Sized>(expr: &Expr, rng: &mut R, num_vars: usize, max_depth: usize) -> Expr {
    if rng.gen_bool(0.15) {
        return random_expr(rng, max_depth.saturating_sub(1), num_vars);
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
            } else {
                **child = random_expr(rng, (max_depth / 2).max(1), num_vars);
            }
        }
        Expr::Binary { op, left, right } => {
            if rng.gen_bool(0.3) {
                *op = random_binary_op(rng);
            }
            if rng.gen_bool(0.5) {
                **left = random_expr(rng, (max_depth / 2).max(1), num_vars);
            } else {
                **right = random_expr(rng, (max_depth / 2).max(1), num_vars);
            }
        }
    }

    out
}

pub fn crossover<R: Rng + ?Sized>(lhs: &Expr, rhs: &Expr, rng: &mut R) -> Expr {
    if rng.gen_bool(0.1) {
        return rhs.clone();
    }

    let donor = random_subexpr(rhs, rng).clone();
    let mut child = lhs.clone();
    let target = random_subexpr_mut(&mut child, rng);
    *target = donor;
    child
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
    match rng.gen_range(0..3) {
        0 => UnaryOp::Identity,
        1 => UnaryOp::Floor,
        _ => UnaryOp::Exp,
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
