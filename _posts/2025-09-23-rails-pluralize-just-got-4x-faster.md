---
layout: post
title: "Rails pluralize Just Got 4x Faster"
author: prateek
categories: [ Rails, Performance, ActiveSupport ]
tags: [ rails, pluralize, performance, optimization, activesupport, inflector ]
excerpt: "Rails optimizes pluralize with regex caching and structural changes, delivering up to 4x performance improvement for uncountable words"
description: "Deep dive into Rails' pluralize optimization that delivers 4x faster performance through regex caching and structural improvements to the Inflector system"
keywords: "rails pluralize performance, activesupport optimization, rails inflector speed, pluralize faster, rails performance improvement"
---

Rails' `pluralize` helper just received a significant performance boost that makes it up to 4 times faster for uncountable words. The optimization, merged in [PR #55485](https://github.com/rails/rails/pull/55485){:target="_blank" rel="noopener noreferrer" aria-label="Rails PR 55485 pluralize optimization (opens in new tab)"}, tackles inefficiencies in the ActiveSupport Inflector through regex caching and structural improvements.

If you're not familiar with `pluralize`, it's the helper that converts singular words to their plural forms:

```ruby
"post".pluralize        # => "posts"
"person".pluralize      # => "people"
"sheep".pluralize       # => "sheep" (uncountable)

# With counts
pluralize(1, "post")    # => "1 post"
pluralize(2, "post")    # => "2 posts"
pluralize(5, "person")  # => "5 people"
```

## The Performance Problem

Rails' pluralization system was creating multiple regex objects and performing redundant operations for every pluralization check. Each uncountable word required its own regex compilation, and the `Uncountables` class inherited from Array, creating unnecessary overhead.

Before the optimization, checking if a word was uncountable meant:
- Creating individual regex patterns for each uncountable word
- Performing multiple regex matches
- Maintaining complex array inheritance structure

## Rails Optimization Approach

The optimization introduces three key improvements:

### 1. Regex Caching with Regexp.union()

**Before:**
```ruby
class Uncountables < Array
  def uncountable?(str)
    each do |word|
      return true if /#{Regexp.escape(word)}/i.match?(str)
    end
    false
  end
end
```

**After:**
```ruby
class Uncountables
  def uncountable?(str)
    @pattern ||= Regexp.union(@members.map { |w| /#{Regexp.escape(w)}/i })
    @pattern.match?(str)
  end
end
```

The new approach creates a single, cached regex pattern using `Regexp.union()` instead of compiling individual patterns for each check.

### 2. Composition Over Inheritance

The `Uncountables` class no longer inherits from Array. Instead, it uses composition with an internal `@members` array and delegates necessary methods:

```ruby
class Uncountables
  extend Forwardable
  def_delegators :@members, :<<, :concat, :each, :clear, :to_a

  def initialize
    @members = []
  end
end
```

### 3. English Inflection Fast Path

A dedicated cache for English inflections reduces instance lookups:

```ruby
def self.instance(locale = :en)
  @__instances__ ||= {}
  @__instances__[locale] ||=
    if locale == :en
      @__en_instance__ ||= new
    else
      new
    end
end
```

## Performance Results

The optimization delivers substantial improvements across all pluralization types:

```ruby
# Benchmark results (iterations/second)
                  Before      After      Improvement
regular         252.175k   298.382k      18% faster
irregular       851.502k   1.943M        128% faster
uncountable     1.487M     6.008M        304% faster (4x)
```

Uncountable words see the most dramatic improvement, going from 1.487M to 6.008M iterations per second. That's a 4x performance increase.

## When This Optimization Matters

This optimization benefits applications that:
- Frequently pluralize words in views and helpers
- Process large datasets with text inflection
- Use Rails' built-in pluralization in tight loops
- Handle user-generated content requiring pluralization

Common scenarios include:
```ruby
# Dashboard counters
pluralize(@users.count, 'user')
pluralize(@orders.count, 'order')

# Data processing
products.each do |product|
  puts "#{product.quantity} #{product.name.pluralize(product.quantity)}"
end

# API responses
render json: {
  message: "Found #{results.count} #{model_name.pluralize(results.count)}"
}
```

## Technical Deep Dive

The optimization works by eliminating regex recompilation. Previously, each `uncountable?` check would create new regex objects:

```ruby
# Before: Creates new regex each time
words = ['equipment', 'information', 'software']
words.each { |word| /#{Regexp.escape(word)}/i.match?('equipment') }
```

Now, a single cached regex handles all uncountable words:

```ruby
# After: One regex for all uncountable words
pattern = Regexp.union([/equipment/i, /information/i, /software/i])
pattern.match?('equipment') # Fast single check
```

The `Regexp.union()` method creates an optimized alternation pattern that the Ruby regex engine can process efficiently.

## Memory and CPU Benefits

Beyond raw speed improvements, the changes reduce:
- **Memory allocation**: Fewer regex objects created
- **CPU overhead**: Single regex compilation vs. multiple
- **GC pressure**: Less object churn from repeated regex creation

Rails applications with heavy text processing will see the most benefit from these efficiency gains.

## Conclusion

Rails' pluralize optimization demonstrates how targeted performance improvements can deliver significant gains. By caching regex patterns and simplifying class structure, the change achieves 4x faster performance for uncountable words while improving overall inflection efficiency.


You might wonder why I'm covering an internal Rails optimization that developers don't need to act on. Truth is, these kinds of improvements fascinate me. A 4x performance boost from clever regex caching and removing unnecessary inheritance? It's elegant problem-solving at its finest. While we won't change our code because of this, understanding how Rails evolves under the hood makes us better developers. Plus, seeing the framework we use daily getting faster without any work on our part? That's just satisfying.