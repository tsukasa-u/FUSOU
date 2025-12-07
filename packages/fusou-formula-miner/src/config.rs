/// Centralized configuration for formula-miner
/// Replaces hardcoded values throughout the codebase
use serde::{Deserialize, Serialize};

/// Expression generation and mutation parameters
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ExpressionConfig {
    /// Probability of completely replacing a subtree during mutation
    pub mutation_replacement_prob: f64,
    /// Probability of changing operator type during mutation
    pub mutation_op_change_prob: f64,
    /// Probability of changing child during unary mutation
    pub mutation_unary_child_prob: f64,
    /// Probability of choosing to mutate left vs right child in binary
    pub mutation_binary_child_prob: f64,
    /// Probability of returning donor expression in crossover
    pub crossover_donor_prob: f64,
    /// Probability of selecting current node in random_subexpr
    pub subexpr_select_prob: f64,
    /// Probability of selecting current node in random_subexpr_mut
    pub subexpr_mut_select_prob: f64,
    /// Probability of selecting left vs right in binary subexpr navigation
    pub subexpr_binary_branch_prob: f64,
    /// Probability of variable vs constant in leaf generation
    pub leaf_var_prob: f64,
    /// Constant generation base range
    pub constant_base_min: f64,
    pub constant_base_max: f64,
    /// Constant generation jitter range
    pub constant_jitter_min: f64,
    pub constant_jitter_max: f64,
    /// Constant mutation delta range
    pub constant_mutation_min: f64,
    pub constant_mutation_max: f64,
    /// Maximum absolute value for clamping
    pub max_abs_value: f64,
    /// Number of operator types (binary + unary) for uniform selection
    pub total_operator_count: usize,
    pub binary_operator_count: usize,
}

impl Default for ExpressionConfig {
    fn default() -> Self {
        Self {
            mutation_replacement_prob: 0.3,
            mutation_op_change_prob: 0.4,
            mutation_unary_child_prob: 0.4,
            mutation_binary_child_prob: 0.5,
            crossover_donor_prob: 0.1,
            subexpr_select_prob: 0.5,
            subexpr_mut_select_prob: 0.3,
            subexpr_binary_branch_prob: 0.5,
            leaf_var_prob: 0.6,
            constant_base_min: -5.0,
            constant_base_max: 5.0,
            constant_jitter_min: -0.25,
            constant_jitter_max: 0.25,
            constant_mutation_min: -1.0,
            constant_mutation_max: 1.0,
            max_abs_value: 1_000_000.0,
            total_operator_count: 13,  // 6 binary + 7 unary
            binary_operator_count: 6,
        }
    }
}

/// Fitness evaluation and selection parameters
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct FitnessConfig {
    /// Complexity penalty per node
    pub complexity_penalty_per_node: f64,
    /// Epsilon for division by zero protection
    pub div_zero_epsilon: f64,
    /// Epsilon for logarithm protection
    pub log_epsilon: f64,
    /// Epsilon for variance/denominator checks
    pub variance_epsilon: f64,
    /// Epsilon for equality comparisons
    pub equality_epsilon: f64,
    /// Exponent clamp range for exp()
    pub exp_clamp_min: f64,
    pub exp_clamp_max: f64,
}

impl Default for FitnessConfig {
    fn default() -> Self {
        Self {
            complexity_penalty_per_node: 0.02,
            div_zero_epsilon: 1e-6,
            log_epsilon: 1e-6,
            variance_epsilon: 1e-10,
            equality_epsilon: 1e-9,
            exp_clamp_min: -15.0,
            exp_clamp_max: 15.0,
        }
    }
}

/// Smart initialization parameters
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SmartInitConfig {
    /// R² threshold for considering linear fit
    pub linear_r_squared_threshold: f64,
    /// R² threshold for considering power fit
    pub power_r_squared_threshold: f64,
    /// Maximum exponent magnitude for power fit
    pub power_max_exponent: f64,
    /// Minimum data points for power regression
    pub power_min_points: usize,
    /// Minimum value threshold for power regression filtering
    pub power_min_value: f64,
    /// Coefficient clamp range for linear expressions
    pub linear_coeff_clamp_min: f64,
    pub linear_coeff_clamp_max: f64,
    /// Coefficient clamp range for power expressions
    pub power_coeff_clamp_min: f64,
    pub power_coeff_clamp_max: f64,
}

impl Default for SmartInitConfig {
    fn default() -> Self {
        Self {
            linear_r_squared_threshold: 0.7,
            power_r_squared_threshold: 0.7,
            power_max_exponent: 3.0,
            power_min_points: 3,
            power_min_value: 0.1,
            linear_coeff_clamp_min: -100.0,
            linear_coeff_clamp_max: 100.0,
            power_coeff_clamp_min: -10.0,
            power_coeff_clamp_max: 10.0,
        }
    }
}

/// Constant optimization parameters (Nelder-Mead)
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ConstOptConfig {
    /// Constant optimization method: "coordinate_descent", "newton_method", or "nelder_mead"
    pub method: String,
    /// Default max iterations for constant optimization
    pub default_max_iterations: usize,
    /// Default learning rate (for Newton's method and coordinate descent)
    pub learning_rate: f64,
    /// Epsilon for numerical differentiation (Newton's method)
    pub newton_epsilon: f64,
    /// Default tolerance for convergence
    pub default_tolerance: f64,
    /// Simplex perturbation size (Nelder-Mead)
    pub simplex_perturbation: f64,
    /// Reflection coefficient (Nelder-Mead)
    pub nelder_mead_alpha: f64,
    /// Expansion coefficient (Nelder-Mead)
    pub nelder_mead_gamma: f64,
    /// Contraction coefficient (Nelder-Mead)
    pub nelder_mead_rho: f64,
    /// Shrink coefficient (Nelder-Mead)
    pub nelder_mead_sigma: f64,
}

impl Default for ConstOptConfig {
    fn default() -> Self {
        Self {
            method: "newton_method".to_string(),  // Use Newton's method by default (more efficient)
            default_max_iterations: 50,  // Increased from 20 for Newton's method
            learning_rate: 0.05,  // Learning rate for Newton's method
            newton_epsilon: 1e-6,  // Epsilon for numerical differentiation
            default_tolerance: 0.01,
            simplex_perturbation: 0.1,
            nelder_mead_alpha: 1.0,
            nelder_mead_gamma: 2.0,
            nelder_mead_rho: 0.5,
            nelder_mead_sigma: 0.5,
        }
    }
}

/// Parameter sweep default ranges
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SweepConfig {
    /// Default sweep: mutation_rate min:max:step
    pub mutation_rate_min: f64,
    pub mutation_rate_max: f64,
    pub mutation_rate_step: f64,
    /// Default sweep: max_depth min:max:step
    pub max_depth_min: f64,
    pub max_depth_max: f64,
    pub max_depth_step: f64,
    /// Default sweep: population_size min:max:step
    pub population_size_min: f64,
    pub population_size_max: f64,
    pub population_size_step: f64,
    /// Default sweep: crossover_rate min:max:step
    pub crossover_rate_min: f64,
    pub crossover_rate_max: f64,
    pub crossover_rate_step: f64,
    /// Default sweep: tournament_size min:max:step
    pub tournament_size_min: f64,
    pub tournament_size_max: f64,
    pub tournament_size_step: f64,
    /// Default sweep: elite_count min:max:step
    pub elite_count_min: f64,
    pub elite_count_max: f64,
    pub elite_count_step: f64,
    /// Default refinement factor
    pub default_refinement_factor: f64,
    /// Default refinement top-k
    pub default_refinement_top_k: usize,
    /// Default repeats per setting
    pub default_repeats: usize,
}

impl Default for SweepConfig {
    fn default() -> Self {
        Self {
            mutation_rate_min: 0.1,
            mutation_rate_max: 0.5,
            mutation_rate_step: 0.1,
            max_depth_min: 3.0,
            max_depth_max: 8.0,
            max_depth_step: 1.0,
            population_size_min: 32.0,
            population_size_max: 256.0,
            population_size_step: 32.0,
            crossover_rate_min: 0.6,
            crossover_rate_max: 0.9,
            crossover_rate_step: 0.1,
            tournament_size_min: 2.0,
            tournament_size_max: 8.0,
            tournament_size_step: 2.0,
            elite_count_min: 1.0,
            elite_count_max: 16.0,
            elite_count_step: 5.0,
            default_refinement_factor: 0.5,
            default_refinement_top_k: 3,
            default_repeats: 1,
        }
    }
}

/// UI display and logging parameters
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct UIConfig {
    /// Maximum number of log lines to retain
    pub max_log_lines: usize,
    /// Maximum formula display length before truncation
    pub max_formula_display_len: usize,
    /// Maximum joined string length in UI
    pub max_ui_string_len: usize,
    /// Number of mismatches to display in verification
    pub verification_max_display: usize,
}

impl Default for UIConfig {
    fn default() -> Self {
        Self {
            max_log_lines: 2000,
            max_formula_display_len: 60,
            max_ui_string_len: 60,
            verification_max_display: 10,
        }
    }
}

/// Synthetic dataset generation parameters
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SyntheticDataConfig {
    /// Number of samples to generate
    pub sample_count: usize,
    /// Attack stat range
    pub atk_min: f64,
    pub atk_max: f64,
    /// Defense stat range
    pub def_min: f64,
    pub def_max: f64,
    /// Luck stat range
    pub luck_min: f64,
    pub luck_max: f64,
    /// Map ID range (integer cast to f64)
    pub map_id_max: i32,
    /// Critical threshold
    pub crit_luck_threshold: f64,
    /// Critical multiplier
    pub crit_multiplier: f64,
    /// Minimum damage floor
    pub min_damage: f64,
    /// Synthetic dataset type: "A" (simple), "B" (moderate), "C" (complex)
    pub dataset_type: String,
}

impl Default for SyntheticDataConfig {
    fn default() -> Self {
        Self {
            sample_count: 500,
            atk_min: 50.0,
            atk_max: 250.0,
            def_min: 5.0,
            def_max: 120.0,
            luck_min: 0.0,
            luck_max: 100.0,
            map_id_max: 10,
            crit_luck_threshold: 80.0,
            crit_multiplier: 1.5,
            min_damage: 1.0,
            dataset_type: "A".to_string(),
        }
    }
}

/// Auto-tuning parameters for adaptive configuration
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AutoTuneConfig {
    /// Base mutation rate for tuning
    pub base_mutation_rate: f64,
    /// Max mutation rate cap
    pub max_mutation_rate: f64,
    /// Mutation rate per-variable adjustment
    pub mutation_per_var_bonus: f64,
    /// Fixed crossover rate
    pub fixed_crossover_rate: f64,
    /// Max depth base
    pub max_depth_base: usize,
    /// Max depth cap
    pub max_depth_cap: usize,
    /// Population size per variable multiplier
    pub pop_per_var_multiplier: usize,
    /// Population size min
    pub pop_min: usize,
    /// Population size max
    pub pop_max: usize,
    /// Elite count divisor (population_size / divisor)
    pub elite_divisor: usize,
    /// Elite count min
    pub elite_min: usize,
    /// Tournament size max
    pub tournament_max: usize,
    /// Tournament size min
    pub tournament_min: usize,
}

impl Default for AutoTuneConfig {
    fn default() -> Self {
        Self {
            base_mutation_rate: 0.25,
            max_mutation_rate: 0.5,
            mutation_per_var_bonus: 1.0,  // adds 1.0 / num_vars
            fixed_crossover_rate: 0.85,
            max_depth_base: 2,
            max_depth_cap: 8,
            pop_per_var_multiplier: 24,
            pop_min: 48,
            pop_max: 256,
            elite_divisor: 8,
            elite_min: 2,
            tournament_max: 6,
            tournament_min: 2,
        }
    }
}

/// Master configuration aggregating all sub-configs
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct MinerConfig {
    pub expression: ExpressionConfig,
    pub fitness: FitnessConfig,
    pub smart_init: SmartInitConfig,
    pub const_opt: ConstOptConfig,
    pub sweep: SweepConfig,
    pub ui: UIConfig,
    pub synthetic_data: SyntheticDataConfig,
    pub auto_tune: AutoTuneConfig,
}

impl Default for MinerConfig {
    fn default() -> Self {
        Self {
            expression: ExpressionConfig::default(),
            fitness: FitnessConfig::default(),
            smart_init: SmartInitConfig::default(),
            const_opt: ConstOptConfig::default(),
            sweep: SweepConfig::default(),
            ui: UIConfig::default(),
            synthetic_data: SyntheticDataConfig::default(),
            auto_tune: AutoTuneConfig::default(),
        }
    }
}

impl MinerConfig {
    /// Load from TOML file, fallback to default on error
    pub fn load_or_default(path: &str) -> Self {
        std::fs::read_to_string(path)
            .ok()
            .and_then(|s| toml::from_str(&s).ok())
            .unwrap_or_default()
    }

    /// Save to TOML file
    pub fn save(&self, path: &str) -> std::io::Result<()> {
        let toml_str = toml::to_string_pretty(self)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
        std::fs::write(path, toml_str)
    }
}
