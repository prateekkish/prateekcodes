---
layout: post
title: "Ruby Ractors: Breaking the GVL for True Parallelism (Part 3)"
author: prateek
categories: [ Ruby, Concurrency, Ractors ]
tags: [ ruby, ractors, parallel-programming, actor-model, ruby-3, concurrency, multicore ]
excerpt: "Explore Ruby Ractors - the experimental feature that enables true parallel execution. Learn how Ractors work, their limitations, and when they can supercharge your Ruby applications."
description: "Deep dive into Ruby Ractors for true parallel programming. Understand the actor model, object isolation, message passing, and how Ractors finally enable Ruby to utilize multiple CPU cores effectively."
keywords: "ruby ractors, parallel ruby, actor model ruby, ruby 3 ractors, multicore ruby, GVL bypass, parallel processing ruby, Ractor.new"
---

After exploring Threads (limited by GVL) and Fibers (cooperative concurrency), we now reach Ruby's most ambitious concurrency feature: Ractors. Introduced in Ruby 3.0 as an experimental feature, Ractors enable true parallel execution across multiple CPU cores.

## What Are Ractors?

Think of Ractors as isolated Ruby interpreters running in parallel. Each Ractor has its own:
- Object space (heap)
- Local variables
- Execution context

They can't accidentally step on each other's toes because they can't share mutable objects.

## The Problem Ractors Solve

Let's see the GVL limitation in action, then watch Ractors break through it:

```ruby
require 'benchmark'

# CPU-intensive work
def heavy_computation
  sum = 0
  10_000_000.times { |i| sum += i }
  sum
end

# Threads: Still bound by GVL
time1 = Benchmark.realtime do
  threads = 4.times.map do
    Thread.new { heavy_computation }
  end
  threads.map(&:value)
end

# Ractors: True parallelism!
time2 = Benchmark.realtime do
  ractors = 4.times.map do
    Ractor.new { heavy_computation }
  end
  ractors.map(&:take)
end

puts "Threads took: #{time1.round(2)}s"
puts "Ractors took: #{time2.round(2)}s"

# Output:
# Threads took: 1.28s
# warning: Ractor is experimental, and the behavior may change in future versions of Ruby! Also there are many implementation issues.
# Ractors took: 0.49s
```

Ractors run in true parallel - that's why they're faster on multi-core machines!

## Understanding Object Isolation

The key to Ractors' parallelism is isolation. Each Ractor lives in its own world:

```ruby
# Variables from outside aren't accessible
name = "Ruby"
r = Ractor.new do
  puts name  # Error!
end
# Error: can not isolate a Proc because it accesses outer variables (name)

# You must explicitly pass data
r = Ractor.new(name) do |n|
  puts "Hello from #{n}"
end
r.take  # "Hello from Ruby"
```

## Object Sharing Rules

Not all objects can be shared between Ractors. Here's what you need to know:

### Shareable Objects (Can be shared freely)

```ruby
# Immutable values
r = Ractor.new(42, true, nil, :symbol) do |int, bool, null, sym|
  [int, bool, null, sym]  # All shareable!
end

# Frozen strings and numbers
frozen_string = "Hello".freeze
r = Ractor.new(frozen_string, 3.14, 1_000_000) do |str, float, bignum|
  "#{str} - #{float} - #{bignum}"
end

# Classes, Modules, and Ractors themselves
r = Ractor.new(String, Enumerable) do |klass, mod|
  klass.name  # "String"
end
```

### Making Objects Shareable

```ruby
# Regular objects aren't shareable
person = { name: "Alice", age: 30 }
r = Ractor.new(person) do |p|
  p[:name]
end
# Error: can not send unshareable object

# Solution 1: Make it shareable
person = { name: "Alice", age: 30 }
Ractor.make_shareable(person)  # Deeply freezes the object
r = Ractor.new(person) do |p|
  p[:name]  # Works!
end
r.take  # "Alice"

# Solution 2: Use shareable_constant_value
# shareable_constant_value: literal
CONFIG = { host: "localhost", port: 3000 }
# CONFIG is now automatically shareable
```

## Communication Patterns

Ractors communicate through message passing. There are two main patterns:

### Push Pattern: Send and Receive

The sender pushes messages to the receiver's inbox:

```ruby
# Create a worker that processes messages
worker = Ractor.new do
  loop do
    msg = Ractor.receive
    puts "Processing: #{msg}"
    break if msg == :stop
  end
  "Worker finished"
end

# Send messages
worker.send("Task 1")
worker.send("Task 2")
worker.send(:stop)

# Get final result
puts worker.take  # "Worker finished"
```

### Pull Pattern: Yield and Take

The producer makes values available for others to take:

```ruby
# Producer generates values
producer = Ractor.new do
  5.times do |i|
    Ractor.yield(i * i)  # Make value available
    sleep(0.1)
  end
  "All done"
end

# Consumer takes values
5.times do
  value = producer.take
  puts "Got: #{value}"
end
puts producer.take  # "All done"
```

## Advanced Communication

### Ractor.select - Waiting for Multiple Ractors

```ruby
# Create multiple workers
workers = 3.times.map do |i|
  Ractor.new(i) do |id|
    sleep(rand(0.1..0.5))
    Ractor.yield("Worker #{id} finished")
  end
end

# Get results as they complete
3.times do
  ractor, result = Ractor.select(*workers)
  puts result
  workers.delete(ractor)
end
```

### Bidirectional Communication

```ruby
# Calculator service
calculator = Ractor.new do
  loop do
    operation = Ractor.receive
    break if operation == :shutdown
    
    result = case operation[:op]
    when :add then operation[:a] + operation[:b]
    when :multiply then operation[:a] * operation[:b]
    end
    
    operation[:reply_to].send(result)
  end
end

# Use the calculator
main = Ractor.current
calculator.send({ op: :add, a: 5, b: 3, reply_to: main })
puts "5 + 3 = #{Ractor.receive}"  # 8

calculator.send({ op: :multiply, a: 4, b: 7, reply_to: main })
puts "4 * 7 = #{Ractor.receive}"  # 28

calculator.send(:shutdown)
```

## Move Semantics: Transferring Ownership

Sometimes you want to transfer an object completely rather than copying it:

```ruby
# Create a large array
big_array = Array.new(1_000_000) { rand }

# Move it to another Ractor (no copying!)
processor = Ractor.new do
  data = Ractor.receive
  data.sum / data.size  # Calculate average
end

processor.send(big_array, move: true)
# big_array is now inaccessible in main Ractor!

begin
  big_array.size  # Error!
rescue => e
  puts e.message  # "can not access moved object"
end

average = processor.take
puts "Average: #{average}"
```

## Practical Example: Parallel Map

Here's how to implement a parallel map using Ractors:

```ruby
def parallel_map(array, worker_count = 4)
  # Create work queue
  queue = array.each_with_index.to_a
  results = Array.new(array.size)
  
  # Create workers
  workers = worker_count.times.map do
    Ractor.new do
      loop do
        item, index = Ractor.receive
        break if item.nil?
        
        # Process item (example: expensive computation)
        result = yield(item)
        Ractor.yield([index, result])
      end
    end
  end
  
  # Distribute work
  queue.each do |item, index|
    workers.sample.send([item, index])
  end
  
  # Send stop signal
  workers.each { |w| w.send([nil, nil]) }
  
  # Collect results
  (array.size).times do
    ractor, (index, result) = Ractor.select(*workers)
    results[index] = result
  end
  
  results
end

# Use it!
numbers = (1..20).to_a
squares = parallel_map(numbers) { |n| n ** 2 }
puts squares.inspect
```

## Common Pitfalls and Solutions

### Accessing External Variables

```ruby
# WRONG: Accessing outer scope
multiplier = 10
r = Ractor.new do
  5 * multiplier  # Error!
end

# RIGHT: Pass as parameter
multiplier = 10
r = Ractor.new(multiplier) do |m|
  5 * m
end
r.take  # 50
```

### Working with Constants

```ruby
# Constants with mutable values need special handling
# shareable_constant_value: literal
SETTINGS = {
  threads: 4,
  timeout: 30
}

r = Ractor.new do
  SETTINGS[:threads]  # Works because of the directive
end
```

### Global State Restrictions

```ruby
# Only main Ractor can access certain features
Ractor.new do
  # These will error:
  # - $global_variable
  # - @@class_variable  
  # - ENV['PATH']
  # - STDIN.gets
end
```

## Performance Reality Check

While Ractors enable parallelism, they're not always faster:

```ruby
# Object allocation heavy workload
def allocation_heavy
  1_000_000.times.map { Object.new }
end

# This can be SLOWER with Ractors due to GC synchronization
time1 = Benchmark.realtime { allocation_heavy }
time2 = Benchmark.realtime do
  r = Ractor.new { allocation_heavy }
  r.take
end

puts "Single: #{time1}s, Ractor: #{time2}s"
# Ractor might be slower!
```

Why? Garbage collection still requires stopping all Ractors. Heavy allocation workloads expose this bottleneck.

## When to Use Ractors

**Good use cases:**
- CPU-intensive calculations (math, cryptography, data processing)
- Parallel processing of independent tasks
- Building actor-based systems
- Scenarios requiring true parallelism

**Poor use cases:**
- I/O-bound operations (use Threads or Fibers)
- Heavy object allocation
- When you need shared mutable state
- Working with gems that aren't Ractor-safe

## The Current State

Let's be honest about Ractors today:

**Strengths:**
- True parallel execution for CPU-bound work
- Elegant actor model prevents race conditions
- Active development and improvements

**Challenges:**
- Experimental status with breaking changes possible
- Most gems don't work with Ractors
- Complex debugging
- GC synchronization bottlenecks
- Steep learning curve

## Looking Forward

Ractors represent CRuby's bet on parallelism. While they're not production-ready for most applications, they show promise for specific use cases. As the ecosystem adapts and performance improves, Ractors may become a powerful tool in Ruby's concurrency toolkit.

For now, approach Ractors with curiosity for experiments and future-proofing. If you need true parallelism in production today, consider the alternatives we explore in [Part 4](/ruby-multithreading-beyond-cruby-part-4/) - JRuby and TruffleRuby already provide mature, battle-tested parallel execution without the experimental nature of Ractors.

## Summary

Ruby's concurrency story continues to evolve:
- **Threads**: Mature, practical for I/O despite GVL in CRuby
- **Fibers**: Lightweight, great for cooperative concurrency
- **Ractors**: Experimental true parallelism in CRuby with trade-offs
- **Alternative Implementations**: JRuby and TruffleRuby offer true parallel threads today (see Part 4)

Each tool has its place. Ractors represent CRuby's experimental approach to parallelism, but if you need proven parallel execution today, Part 4 explores how JRuby and TruffleRuby already deliver it without the complexities of Ractors.

## References

- [Ruby Ractor Documentation](https://docs.ruby-lang.org/en/3.4/ractor_md.html){:target="_blank" rel="noopener noreferrer" aria-label="Ruby Ractor Documentation (opens in new tab)"}
- [Ractor Design Document](https://docs.ruby-lang.org/en/3.4/doc/ractor_md.html){:target="_blank" rel="noopener noreferrer" aria-label="Ractor design document (opens in new tab)"}
- [Understanding Ruby Ractors](https://blog.appsignal.com/2022/08/24/an-introduction-to-ractors-in-ruby.html){:target="_blank" rel="noopener noreferrer" aria-label="Understanding Ruby Ractors on AppSignal (opens in new tab)"}