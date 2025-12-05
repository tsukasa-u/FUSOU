#!/bin/bash
# Setup script for plotting functionality
# This installs required Python dependencies

echo "Installing Python dependencies for plot_results.py..."

# Try different approaches based on system configuration
if command -v pip3 &> /dev/null; then
    echo "Using pip3..."
    pip3 install --user numpy matplotlib scikit-learn scipy
elif command -v pip &> /dev/null; then
    echo "Using pip..."
    pip install --user numpy matplotlib scikit-learn scipy
else
    echo "pip not found. Trying apt (requires sudo)..."
    sudo apt-get update
    sudo apt-get install -y python3-pip python3-numpy python3-matplotlib python3-sklearn python3-scipy
fi

echo "Dependencies installed successfully!"
echo ""
echo "Quick test:"
python3 -c "import numpy, matplotlib, sklearn, scipy; print('✓ All packages available')"

echo ""
echo "You can now use plot_results.py:"
echo "  python3 plot_results.py <dump_file.json> [--output result.png]"
