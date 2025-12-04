use rand::prelude::*;

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Op {
    Add,
    Sub,
    Mul,
    Div,
    Max,
    Exp,
}

#[derive(Clone, Debug)]
pub enum Expr {
    Const(f64),
    Var(usize),
    Binary(Op, Box<Expr>, Box<Expr>),
    Unary(Op, Box<Expr>),
}

impl Expr {
    pub fn eval(&self, vars: &[f64]) -> f64 {
        match self {
            Expr::Const(c) => *c,
            Expr::Var(i) => *vars.get(*i).unwrap_or(&0.0),
            Expr::Binary(op, l, r) => {
                let lv = l.eval(vars);
                let rv = r.eval(vars);
                match op {
                    Op::Add => lv + rv,
                    Op::Sub => lv - rv,
                    Op::Mul => lv * rv,
                    Op::Div => {
                        if rv.abs() < 1e-4 {
                            0.0
                        } else {
                            lv / rv
                        }
                    }
                    Op::Max => lv.max(rv),
                    _ => 0.0,
                }
            }
            Expr::Unary(Op::Exp, c) => c.eval(vars).exp(),
            _ => 0.0,
        }
    }

    pub fn to_string(&self, vars: &[&str]) -> String {
        match self {
            Expr::Const(c) => format!("{:.1}", c),
            Expr::Var(i) => vars.get(*i).unwrap_or(&"?").to_string(),
            Expr::Binary(op, l, r) => {
                let s = match op {
                    Op::Add => "+",
                    Op::Sub => "-",
                    Op::Mul => "*",
                    Op::Div => "/",
                    Op::Max => "max",
                    _ => "?",
                };
                if matches!(op, Op::Max) {
                    format!("max({}, {})", l.to_string(vars), r.to_string(vars))
                } else {
                    format!("({} {} {})", l.to_string(vars), s, r.to_string(vars))
                }
            }
            Expr::Unary(Op::Exp, c) => format!("exp({})", c.to_string(vars)),
            _ => "err".to_string(),
        }
    }
}

pub fn random_expr(depth: i32, rng: &mut ThreadRng, num_vars: usize) -> Expr {
    if depth == 0 || rng.gen_bool(0.3) {
        if rng.gen_bool(0.5) {
            Expr::Const(rng.gen_range(1.0_f64..5.0_f64).round())
        } else {
            Expr::Var(rng.gen_range(0..num_vars))
        }
    } else {
        match rng.gen_range(0..5) {
            0 => Expr::Binary(
                Op::Add,
                Box::new(random_expr(depth - 1, rng, num_vars)),
                Box::new(random_expr(depth - 1, rng, num_vars)),
            ),
            1 => Expr::Binary(
                Op::Sub,
                Box::new(random_expr(depth - 1, rng, num_vars)),
                Box::new(random_expr(depth - 1, rng, num_vars)),
            ),
            2 => Expr::Binary(
                Op::Mul,
                Box::new(random_expr(depth - 1, rng, num_vars)),
                Box::new(random_expr(depth - 1, rng, num_vars)),
            ),
            3 => Expr::Binary(
                Op::Max,
                Box::new(random_expr(depth - 1, rng, num_vars)),
                Box::new(random_expr(depth - 1, rng, num_vars)),
            ),
            _ => random_expr(depth - 1, rng, num_vars),
        }
    }
}

pub fn mutate(expr: &Expr, rng: &mut ThreadRng, num_vars: usize) -> Expr {
    if rng.gen_bool(0.2) {
        return random_expr(2, rng, num_vars);
    }
    match expr {
        Expr::Binary(op, l, r) => Expr::Binary(
            *op,
            Box::new(mutate(l, rng, num_vars)),
            Box::new(mutate(r, rng, num_vars)),
        ),
        _ => expr.clone(),
    }
}
