terraform {
  required_version = ">= 1.6.0"
}

# Mirror of production with smaller resources and a separate state.
# See ../production/main.tf for the module wiring pattern.
