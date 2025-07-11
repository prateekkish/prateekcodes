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

> **Quick Reminder: The GVL Limitation**
>
> The Global VM Lock (GVL) in CRuby prevents multiple threads from executing Ruby code simultaneously, limiting them to I/O concurrency. While threads can handle I/O operations in parallel, only one thread can execute Ruby code at a time. Ractors break this limitation by creating isolated Ruby interpreters that can run in parallel without sharing mutable state.

## What Are Ractors?

Think of Ractors as isolated Ruby interpreters running in parallel. Each Ractor has its own:
- Object space (heap)
- Local variables
- Execution context

They can't accidentally step on each other's toes because they can't share mutable objects.

![Ruby Ractors Architecture](/assets/images/ractors.png)

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

### The shareable_constant_value Directive

This magic comment introduced in Ruby 3.0 tells Ruby how to handle constants for Ractor sharing:

```ruby
# shareable_constant_value: literal
# Makes constants with literal values automatically frozen and shareable
SETTINGS = { timeout: 30, retries: 3 }  # Frozen recursively
NUMBERS = [1, 2, 3]                     # Frozen array with frozen elements

# shareable_constant_value: experimental_everything
# Makes ALL constants shareable (use with caution!)
class MyConfig
  DEFAULTS = { host: "localhost" }      # Automatically shareable
end

# shareable_constant_value: experimental_copy
# Deep copies constants when sharing between Ractors
MUTABLE_CONFIG = { counter: 0 }         # Each Ractor gets its own copy

# shareable_constant_value: none
# Default behavior - constants aren't automatically shareable
NORMAL_HASH = { a: 1 }                  # Must use Ractor.make_shareable manually
```

You can also scope the directive:

```ruby
# shareable_constant_value: literal
module Api
  ENDPOINTS = {                         # This is shareable
    users: "/api/users",
    posts: "/api/posts"
  }

  # shareable_constant_value: none
  CACHE = {}                            # This is not shareable
end
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

When you have multiple Ractors running concurrently, you often need to respond to whichever one completes first. `Ractor.select` is your Swiss Army knife for this - it blocks until one of the given Ractors is ready to yield a value, then returns both the ready Ractor and its value. This pattern is perfect for building responsive systems that process results as they become available, rather than waiting for all tasks to complete in a predetermined order.

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

While simple one-way message passing works for many scenarios, real-world systems often need request-response patterns. By including a "reply_to" Ractor reference in your messages, you can build sophisticated services where Ractors act as independent microservices within your application. This pattern shines when building actor-based architectures where different Ractors handle specific responsibilities and communicate through well-defined message protocols.

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

### The Main Ractor

Ruby starts with one special Ractor - the main Ractor. It has special privileges:

Not all Ractors are created equal. The main Ractor - the one Ruby starts with - has superpowers that other Ractors don't. It's the only Ractor allowed to perform operations that affect the global state of your Ruby process, like requiring files, accessing environment variables, or reading from STDIN. Understanding this distinction is crucial for architecting Ractor-based applications: your main Ractor often becomes the coordinator, handling system-level operations and delegating pure computation to worker Ractors.

```ruby
# Check if we're in the main Ractor
puts Ractor.main == Ractor.current  # true (in main thread)

# Main Ractor can access things others can't
main_only_features = Ractor.new do
  begin
    # These operations are only allowed in main Ractor:
    # - Requiring files
    # - Accessing ENV
    # - Using stdin/stdout directly
    # - Modifying global variables

    require 'json'  # Error!
  rescue => e
    "Error: #{e.message}"
  end
end

puts main_only_features.take
# "Error: can not access non-shareable objects in constant Object::ENV by non-main Ractor"

# Main Ractor should handle these operations
data = JSON.parse('{"key": "value"}')  # Works in main
worker = Ractor.new(data) do |parsed_data|
  # Worker processes already parsed data
  parsed_data["key"]
end
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

## Ractor Lifecycle

Understanding when Ractors start and stop is crucial for building reliable concurrent programs:

```ruby
# Ractors begin execution immediately upon creation
r = Ractor.new do
  puts "Started immediately!"
  sleep(1)
  "Final result"
end

# Ractors don't have a direct way to check if they're running
# You can only wait for their result with take or select

# Take blocks until the Ractor finishes
result = r.take  # "Final result"
puts "Got result: #{result}"

# Calling take again on terminated Ractor raises error
begin
  r.take
rescue Ractor::ClosedError => e
  puts "Ractor is closed"
end

# Example showing Ractor lifecycle with multiple Ractors
workers = 3.times.map do |i|
  Ractor.new(i) do |id|
    sleep(id * 0.5)  # Different sleep times
    "Worker #{id} done"
  end
end

# Ractor.select waits for the first available result
while workers.any?
  ractor, result = Ractor.select(*workers)
  puts result
  workers.delete(ractor)  # Remove completed Ractor
end
```

### Handling Unreceived Messages

```ruby
# Messages are lost if Ractor terminates
sender = Ractor.new do
  receiver = Ractor.receive
  receiver.send("Message 1")
  receiver.send("Message 2")
  # Ractor terminates here - any unsent messages are lost
end

receiver = Ractor.new do
  sleep(0.1)  # Simulate being busy
  # By the time we try to receive, sender might be gone
  Ractor.receive rescue "No message"
end

sender.send(receiver)
```

## Exception Handling Across Ractors

When a Ractor raises an exception, Ruby wraps it in a `Ractor::RemoteError` before passing it across Ractor boundaries. This wrapper preserves the original exception as the `cause`, allowing you to access both the context of where the error crossed Ractor boundaries and the original error details. This design ensures that exceptions from parallel execution contexts are clearly distinguished from local exceptions:

```ruby
# Basic exception handling
worker = Ractor.new do
  raise ArgumentError, "Something went wrong!"
end

begin
  worker.take
rescue Ractor::RemoteError => e
  puts "Remote error: #{e.message}"
  puts "Original error: #{e.cause.class} - #{e.cause.message}"

  # You can re-raise the original exception if needed
  raise e.cause
rescue ArgumentError => e
  puts "Handled original ArgumentError: #{e.message}"
end
```

### Handling Errors in Worker Pools

```ruby
def safe_parallel_process(items)
  workers = items.map do |item|
    Ractor.new(item) do |data|
      # Wrap work in exception handling
      begin
        # Potentially failing work
        raise "Failed!" if data == 13  # Unlucky number
        data * 2
      rescue => e
        { error: e.message, item: data }
      end
    end
  end

  # Collect results and errors
  results = workers.map do |worker|
    begin
      worker.take
    rescue Ractor::RemoteError => e
      { error: "Ractor crashed", cause: e.cause.message }
    end
  end

  errors = results.select { |r| r.is_a?(Hash) && r[:error] }
  puts "Errors: #{errors}" unless errors.empty?

  results.reject { |r| r.is_a?(Hash) && r[:error] }
end

# Usage
safe_parallel_process([1, 2, 13, 4, 5])
# Errors: [{:error=>"Failed!", :item=>13}]
# Returns: [2, 4, 8, 10]
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

### Debugging Tips

Name your Ractors for easier debugging:

```ruby
# Named Ractors make debugging much easier
worker = Ractor.new(name: "DataProcessor") do
  loop do
    data = Ractor.receive
    puts "[#{Ractor.current.name}] Processing: #{data}"
    break if data == :stop
  end
end

# In error messages, you'll see the name
worker.send("important data")
worker.send(:stop)

# Create multiple named workers
workers = 3.times.map do |i|
  Ractor.new(name: "Worker-#{i}") do
    # Worker logic
    Ractor.yield("#{Ractor.current.name} completed")
  end
end

# Easy to identify which worker responded
workers.each do |w|
  puts w.take
end

# Output:
# [DataProcessor] Processing: important data
# [DataProcessor] Processing: stop
# Worker-0 completed
# Worker-1 completed
# Worker-2 completed
```

## Performance Reality Check

While Ractors enable parallelism, they're not always faster:

```ruby
require 'benchmark'

# Small, quick task - Ractor overhead dominates
def quick_calculation
  sum = 0
  1000.times { |i| sum += i }
  sum
end

# Run many iterations to see overhead
iterations = 100_000

# Single process
time1 = Benchmark.realtime do
  iterations.times { quick_calculation }
end

# With Ractor creation overhead
time2 = Benchmark.realtime do
  iterations.times do
    r = Ractor.new { quick_calculation }
    r.take
  end
end

puts "Single: #{time1.round(3)}s"
puts "Ractors: #{time2.round(3)}s"
puts "Overhead: #{((time2 - time1) / time1 * 100).round(1)}%"

# Example output:
# Single: 3.464s
# Ractors: 5.571s
# Overhead: 60.8%
```

Why the massive overhead? Creating a Ractor has significant startup cost. For small, quick tasks, this overhead completely dominates the execution time. Ractors are designed for long-running, CPU-intensive work where the parallelism benefits outweigh the creation costs - not for tiny tasks that complete in microseconds.

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
- Experimental status with breaking changes possible (Ruby 3.5 preview shows API changes like the removal of `Ractor#close` method)
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