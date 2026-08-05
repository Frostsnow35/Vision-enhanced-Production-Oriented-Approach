#!/usr/bin/env python3
"""
CodeGraph Project Analyzer

This script automates CodeGraph analysis for a project.
It initializes, builds, and generates a summary report.

Usage:
    python analyze_project.py [project_path]
    
If no path is provided, uses current directory.
"""

import subprocess
import os
import sys
from datetime import datetime


def run_command(cmd, cwd=None):
    """Run a command and return output."""
    try:
        result = subprocess.run(
            cmd,
            cwd=cwd,
            capture_output=True,
            text=True,
            check=True
        )
        return result.stdout, result.stderr
    except subprocess.CalledProcessError as e:
        return e.stdout, e.stderr


def analyze_project(project_path):
    """Run full CodeGraph analysis on a project."""
    print(f"🚀 Starting CodeGraph analysis for: {project_path}")
    print(f"⏰ Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print()

    # Initialize CodeGraph
    print("1️⃣ Initializing CodeGraph...")
    stdout, stderr = run_command(["codegraph", "init"], cwd=project_path)
    if stderr:
        print(f"   {stderr.strip()}")
    else:
        print("   ✅ Initialized successfully")

    # Build the graph
    print("2️⃣ Building code graph...")
    stdout, stderr = run_command(["codegraph", "build"], cwd=project_path)
    if stderr:
        print(f"   {stderr.strip()}")
    else:
        print("   ✅ Graph built successfully")

    # Get structure
    print("3️⃣ Analyzing structure...")
    stdout, stderr = run_command(["codegraph", "structure"], cwd=project_path)
    print(stdout)

    # Find dead code
    print("4️⃣ Checking for dead code...")
    stdout, stderr = run_command(["codegraph", "dead-code"], cwd=project_path)
    print(stdout)

    # Check cycles
    print("5️⃣ Checking for cycles...")
    stdout, stderr = run_command(["codegraph", "cycles"], cwd=project_path)
    print(stdout)

    print()
    print("📊 Analysis complete!")
    print("🎯 Run 'codegraph mcp serve' to enable AI agent integration")


def main():
    project_path = sys.argv[1] if len(sys.argv) > 1 else os.getcwd()
    
    if not os.path.isdir(project_path):
        print(f"❌ Error: {project_path} is not a valid directory")
        sys.exit(1)

    analyze_project(project_path)


if __name__ == "__main__":
    main()
