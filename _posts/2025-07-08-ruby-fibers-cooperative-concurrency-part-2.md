---
layout: post
title: "Ruby Fibers: Mastering Cooperative Concurrency (Part 2)"
author: prateek
categories: [ Ruby, Concurrency, Fibers ]
tags: [ ruby, fibers, concurrency, cooperative-multitasking, async-ruby, fiber-scheduler ]
excerpt: "Discover Ruby Fibers - lightweight concurrency primitives that give you precise control over execution flow. Learn how Fibers differ from Threads and enable efficient I/O handling."
description: "Deep dive into Ruby Fibers for cooperative concurrency. Understand how Fibers work, when to use them over Threads, and explore the Fiber Scheduler API for non-blocking I/O operations."
keywords: "ruby fibers, fiber scheduler, cooperative concurrency ruby, async ruby, non-blocking io ruby, Fiber.yield, Fiber.resume, ruby concurrency patterns"
---

In [Part 1](/ruby-threads-explained-simple-guide-part-1/), we learned that threads give us concurrency but are limited by the GVL in CRuby. Now let's explore Fibers - Ruby's answer to lightweight, cooperative concurrency that puts you in control.

**Note:** While Fibers are available in all major Ruby implementations (CRuby, JRuby, TruffleRuby), the Fiber Scheduler API and its async I/O benefits are most relevant to CRuby. JRuby and TruffleRuby already have true parallel threads, making Fibers less critical for concurrent I/O operations.

## Threads vs Fibers: The Key Difference

Threads are preemptive - the operating system decides when to switch between them. Fibers are cooperative - you decide exactly when to pause and resume execution.

```ruby
# Thread: OS controls switching
Thread.new { puts "Thread runs whenever OS decides" }

# Fiber: You control switching
fiber = Fiber.new { puts "Fiber runs when YOU call resume" }
fiber.resume  # Explicitly run the fiber
```

## Understanding Fibers

A Fiber is like a pausable function. You can stop execution at any point, do something else, then come back exactly where you left off.

```ruby
# Basic Fiber example
greeting_fiber = Fiber.new do
  puts "Hello"
  Fiber.yield  # Pause here
  puts "How are you?"
  Fiber.yield  # Pause again
  puts "Goodbye!"
end

greeting_fiber.resume  # Prints "Hello", then pauses
puts "Doing other work..."
greeting_fiber.resume  # Prints "How are you?", then pauses
puts "More work..."
greeting_fiber.resume  # Prints "Goodbye!"
```

## Passing Values with Fibers

Fibers can exchange data during pauses and resumes:

```ruby
calculator = Fiber.new do |initial|
  puts "Starting with: #{initial}"

  value = Fiber.yield(initial * 2)  # Return doubled, get new value
  puts "Received: #{value}"

  result = value + 10
  Fiber.yield(result)  # Return result

  "All done!"
end

result1 = calculator.resume(5)      # Starting with: 5, returns 10
result2 = calculator.resume(result1) # Received: 10, returns 20
final = calculator.resume           # Returns "All done!"

puts "Results: #{result1}, #{result2}, #{final}"
# Starting with: 5
# Received: 10
# Results: 10, 20, All done!
```

Here's what's happening:
- `Fiber.yield(initial * 2)` pauses the fiber AND returns `initial * 2` to the caller
- When resumed with `calculator.resume(result1)`, that value becomes the return value of `Fiber.yield`
- It's two-way communication: yield sends a value out, resume sends a value in

## Real-World Example: Generating Sequences

Fibers excel at creating generators:

```ruby
def fibonacci_generator
  Fiber.new do
    a, b = 0, 1
    loop do
      Fiber.yield(a)
      a, b = b, a + b
    end
  end
end

fib = fibonacci_generator
10.times do
  puts fib.resume
end
# Prints: 0, 1, 1, 2, 3, 5, 8, 13, 21, 34
```

## The Fiber Scheduler: Non-Blocking I/O Magic

Ruby 3.0 introduced the Fiber Scheduler API, enabling non-blocking I/O operations without callbacks:

```ruby
require 'async'

# Using the Async gem which implements Fiber Scheduler
Async do
  # These run concurrently despite looking sequential!
  task1 = Async do
    response = Net::HTTP.get(URI('https://api.github.com/users/ruby'))
    puts "Ruby user fetched"
  end

  task2 = Async do
    response = Net::HTTP.get(URI('https://api.github.com/users/rails'))
    puts "Rails user fetched"
  end

  task3 = Async do
    sleep(1)  # Non-blocking sleep!
    puts "Slept for 1 second"
  end
end
```

## Practical Fiber Patterns

### Producer-Consumer Pattern

This pattern separates data generation from data processing, allowing each to work at its own pace:

```ruby
producer = Fiber.new do
  items = %w[apple banana cherry date elderberry]
  items.each do |item|
    puts "Producing: #{item}"
    Fiber.yield(item)  # Pause and hand over the item
  end
end

consumer = Fiber.new do |producer_fiber|
  while producer_fiber.alive?
    item = producer_fiber.resume  # Get next item from producer
    puts "Consuming: #{item}"
    sleep(0.5)  # Simulate processing
  end
end

consumer.resume(producer)
```

The producer yields items one at a time, and the consumer processes them. This is useful for handling streams of data without loading everything into memory at once.

### State Machine with Fibers

Fibers naturally model state machines where each state can pause and wait for the next transition:

```ruby
class TrafficLight
  def initialize
    @fiber = Fiber.new do
      loop do
        puts "🔴 Red light - Stop!"
        sleep(3)
        Fiber.yield  # Pause after red state

        puts "🟡 Yellow light - Prepare!"
        sleep(1)
        Fiber.yield  # Pause after yellow state

        puts "🟢 Green light - Go!"
        sleep(3)
        Fiber.yield  # Pause after green state
      end
    end
  end

  def next_state
    @fiber.resume  # Move to next state
  end
end

light = TrafficLight.new
5.times { light.next_state }
```

Each call to `next_state` advances the traffic light to its next phase. The fiber maintains the current state between calls, making the state machine logic clean and sequential.

## Memory Efficiency: Fibers vs Threads

Fibers are much lighter than threads:

```ruby
require 'objspace'

# Memory usage of a Thread
thread = Thread.new { sleep }
thread_size = ObjectSpace.memsize_of(thread)

# Memory usage of a Fiber
fiber = Fiber.new { Fiber.yield }
fiber_size = ObjectSpace.memsize_of(fiber)

puts "Thread memory: #{thread_size} bytes"
puts "Fiber memory: #{fiber_size} bytes"
puts "Ratio: #{thread_size / fiber_size.to_f}x"
# Thread memory: 1049112 bytes
# Fiber memory: 1488 bytes
# Ratio: 705.0483870967741x
# Threads use significantly more memory!
```

## When to Use Fibers

**Use Fibers for:**
- Generators and iterators
- State machines
- Cooperative multitasking
- Non-blocking I/O with Fiber Scheduler (CRuby 3.0+)
- Memory-constrained environments

**Use Threads for:**
- Concurrent I/O operations (threads can switch during I/O waits)
- Blocking operations without Fiber Scheduler support
- Integration with thread-based libraries
- When you need preemptive multitasking (OS controls switching)

## Fiber Gotchas

```ruby
# Cannot resume a fiber from within itself
fiber = Fiber.new do
  fiber.resume  # FiberError!
end

# Cannot yield from main fiber
Fiber.yield  # FiberError: attempt to yield on a not resumed fiber

# Dead fibers cannot be resumed
dead_fiber = Fiber.new { "done" }
dead_fiber.resume  # Returns "done"
dead_fiber.resume  # FiberError: attempt to resume a terminated fiber
```

## Advanced: Fiber.transfer

For even more control, use `transfer` instead of `yield/resume`:

```ruby
fiber1 = Fiber.new do
  puts "Fiber 1 starting"
  fiber2.transfer
  puts "Fiber 1 resumed"
end

fiber2 = Fiber.new do
  puts "Fiber 2 starting"
  fiber1.transfer
  puts "Fiber 2 resumed"
end

fiber1.resume
# Output:
# Fiber 1 starting
# Fiber 2 starting
# Fiber 1 resumed
```

The key difference: with `yield/resume`, control always returns to the caller. With `transfer`, you explicitly choose which fiber gets control next, creating a peer-to-peer relationship rather than a parent-child one. This enables more complex coordination patterns but requires careful management to avoid getting stuck.

## The Reality Check

While Fibers are powerful, they come with caveats:
- Limited ecosystem support compared to threads
- Debugging can be challenging with complex fiber interactions
- The Fiber Scheduler API (CRuby 3.0+) is still evolving
- Not all I/O operations are fiber-aware yet

For many applications, threads remain the pragmatic choice despite their limitations.

## What's Next?

Fibers give us lightweight concurrency with precise control, perfect for I/O-bound operations. But what if we need true parallelism across CPU cores? 

In Part 3, we'll explore Ractors - Ruby's ambitious but controversial feature that attempts to break free from the GVL in CRuby. And in Part 4, we'll discover how alternative Ruby implementations like JRuby and TruffleRuby already deliver true parallel threads without any GVL limitations.

While Fibers excel at cooperative concurrency within a single thread, the journey to true parallelism takes two different paths: Ractors for CRuby users, or switching to JRuby/TruffleRuby for immediate parallel execution.

## References

- [Ruby Fiber Documentation](https://ruby-doc.org/3.4.1/Fiber.html){:target="_blank" rel="noopener noreferrer" aria-label="Ruby Fiber Documentation (opens in new tab)"}
- [Async Ruby Gem](https://github.com/socketry/async){:target="_blank" rel="noopener noreferrer" aria-label="Async Ruby gem on GitHub (opens in new tab)"}
- [Fiber Scheduler Interface](https://github.com/ruby/ruby/blob/master/doc/fiber.md#scheduler){:target="_blank" rel="noopener noreferrer" aria-label="Ruby Fiber Scheduler interface documentation on GitHub (opens in new tab)"}