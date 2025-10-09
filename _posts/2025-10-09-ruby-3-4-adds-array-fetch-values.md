---
layout: post
title: "Ruby 3.4 Adds Array#fetch_values for Safe Multi-Index Access"
author: prateek
categories: [ Ruby, Ruby 3.4 ]
tags: [ ruby, arrays, fetch, ruby-3.4 ]
excerpt: "Ruby 3.4 introduces Array#fetch_values to safely retrieve multiple array elements with default value support, bringing consistency with Hash#fetch_values."
description: "Learn how Ruby 3.4's Array#fetch_values method provides safe multi-index array access with default values and block support, solving common nil-checking patterns."
keywords: "ruby 3.4, array fetch_values, ruby arrays, safe array access, ruby default values, array methods, hash fetch_values, ruby index error handling"
---

Accessing multiple array elements by index often requires repetitive nil checks or error handling. Ruby 3.4 introduces `Array#fetch_values` to retrieve multiple elements safely with default value support.

## Before Ruby 3.4

When accessing multiple array indices, you had to choose between unsafe access with `values_at` (which returns `nil` for out-of-bounds indices) or multiple `fetch` calls:

```ruby
# Using values_at - returns nil for missing indices
config = ['production', 'us-east-1', '5432']
env, region, port, backup_port = config.values_at(0, 1, 2, 5)
# => ['production', 'us-east-1', '5432', nil]
# Silent failure - backup_port is nil

# Using multiple fetch calls - verbose and repetitive
env = config.fetch(0)
region = config.fetch(1)
port = config.fetch(2)
backup_port = config.fetch(5, '5433') # Default value
```

This pattern became even more cumbersome when you needed different default values for different indices or wanted consistent error handling across multiple accesses.

## Ruby 3.4

`Array#fetch_values` provides a single method to fetch multiple elements with the same safety guarantees as `fetch`:

```ruby
config = ['production', 'us-east-1', '5432']

# Fetch multiple values safely
config.fetch_values(0, 1, 2)
# => ['production', 'us-east-1', '5432']

# Raises IndexError for out-of-bounds indices
config.fetch_values(0, 1, 5)
# IndexError (index 5 outside of array bounds: -3...3)

# Use a default value for all missing indices
config.fetch_values(0, 1, 2, 5) { |index| 'default' }
# => ['production', 'us-east-1', '5432', 'default']

# Negative indices work as expected
config.fetch_values(-3, -2, -1)
# => ['production', 'us-east-1', '5432']
```

The block form allows dynamic default values based on the index:

```ruby
headers = ['Name', 'Email', 'Role']

# Generate placeholder text for missing columns
headers.fetch_values(0, 1, 3, 4) { |index| "Column #{index}" }
# => ['Name', 'Email', 'Column 3', 'Column 4']

# Use the index to compute defaults
data = [100, 200, 300]
data.fetch_values(0, 2, 5, 7) { |index| index * 10 }
# => [100, 300, 50, 70]
```

### Real-World Usage

Parsing CSV headers where certain columns are optional:

```ruby
csv_row = ['John Doe', 'john@example.com', 'Engineer']
REQUIRED_INDICES = [0, 1]  # Name and email required
OPTIONAL_INDICES = [2, 3, 4]  # Role, department, location optional

# Before: Mix of fetch and values_at
required = REQUIRED_INDICES.map { |i| csv_row.fetch(i) }
optional = csv_row.values_at(*OPTIONAL_INDICES)

# Ruby 3.4: Consistent approach
required = csv_row.fetch_values(*REQUIRED_INDICES)
optional = csv_row.fetch_values(*OPTIONAL_INDICES) { 'N/A' }
# => ['John Doe', 'john@example.com'] and ['Engineer', 'N/A', 'N/A']
```

Extracting configuration values with validation:

```ruby
settings = ['api.example.com', '443', 'true']

# Ensure all required settings exist
host, port, ssl_enabled = settings.fetch_values(0, 1, 2)
# Raises IndexError if any setting is missing

# Optional settings with defaults
cache_size, timeout = settings.fetch_values(3, 4) { '1000' }
# => ['1000', '1000']
```

## Key Differences from Array#values_at

- **Error handling**: `fetch_values` raises `IndexError` for out-of-bounds indices (without a block), while `values_at` returns `nil`
- **Default values**: `fetch_values` accepts a block to provide defaults; `values_at` has no default mechanism
- **Consistency**: Aligns with `Hash#fetch_values` behavior, providing a familiar API

## When to Use Array#fetch_values

- Extracting multiple required values that must exist
- Accessing indices where `nil` is a valid value (and shouldn't indicate missing data)
- Providing consistent default values for missing elements
- Validating array structure by ensuring required indices are present

## Conclusion

`Array#fetch_values` brings consistency between Hash and Array APIs while solving the common pattern of safely accessing multiple indices. It provides the strictness of `fetch` with the multi-value convenience of `values_at`.

## References

- [Feature #20953: Array#fetch_values](https://bugs.ruby-lang.org/issues/20953){:target="_blank" rel="noopener noreferrer" aria-label="Ruby Feature Request 20953 (opens in new tab)"}
- [Ruby 3.4.0 Release Notes](https://www.ruby-lang.org/en/news/2024/12/25/ruby-3-4-0-released/){:target="_blank" rel="noopener noreferrer" aria-label="Ruby 3.4.0 Release Announcement (opens in new tab)"}
- [Array Documentation - Ruby 3.4](https://docs.ruby-lang.org/en/3.4/Array.html#method-i-fetch_values){:target="_blank" rel="noopener noreferrer" aria-label="Ruby 3.4 Array documentation (opens in new tab)"}
