---
layout: post
title: "Ruby Threads Explained: A Simple Guide to Multithreading (Part 1)"
author: prateek
categories: [ Ruby, Concurrency, Threading ]
tags: [ ruby, threads, multithreading, concurrency, parallel-programming, gvl, gil ]
excerpt: "Learn Ruby threads from the ground up with simple examples. Understand how multithreading works in Ruby, why the GVL exists, and when to use threads effectively."
description: "A beginner-friendly guide to understanding threads and multithreading in Ruby. Learn what threads are, how Ruby handles them with the Global VM Lock, and practical examples with clear explanations."
keywords: "ruby threads, ruby multithreading, ruby concurrency, GVL ruby, Global VM Lock, thread safety ruby, ruby parallel processing, Thread.new ruby"
---

Think of your Ruby program as a kitchen with one chef. The chef can only do one thing at a time - chop vegetables, then stir the pot, then check the oven. But what if you could have multiple chefs working together?

## What Are Threads?

A thread is like having multiple workers inside your single Ruby program. Each thread can execute code independently, allowing multiple tasks to happen concurrently.

```ruby
# Single-threaded: Tasks happen one after another
puts "Making coffee..."
sleep(3)  # Takes 3 seconds
puts "Making toast..."
sleep(2)  # Takes 2 seconds
puts "Breakfast ready!"
# Total time: 5 seconds
```

```ruby
# Multi-threaded: Tasks happen simultaneously
thread1 = Thread.new do
  puts "Making coffee..."
  sleep(3)
  puts "Coffee ready!"
end

thread2 = Thread.new do
  puts "Making toast..."
  sleep(2)
  puts "Toast ready!"
end

thread1.join  # Wait for coffee
thread2.join  # Wait for toast
puts "Breakfast ready!"
# Total time: 3 seconds (only as long as the slowest task!)
```

## The Ruby Thread Basics

Creating a thread is simple with `Thread.new`:

```ruby
# Create a thread that counts to 5
counter_thread = Thread.new do
  5.times do |i|
    puts "Thread counting: #{i + 1}"
    sleep(1)
  end
end

# Main thread continues doing its own work
3.times do |i|
  puts "Main thread working: #{i + 1}"
  sleep(1.5)
end

# Now wait for the counter thread to finish
counter_thread.join
puts "All done!"

# Output:
# Main thread working: 1
# Thread counting: 1
# Thread counting: 2
# Main thread working: 2
# Thread counting: 3
# Main thread working: 3
# Thread counting: 4
# Thread counting: 5
# All done!
```

Notice how `sleep` causes thread switching? When a thread calls `sleep`, it tells Ruby "I'm going to rest for a bit" - this releases the GVL and allows other threads to run. That's why the main thread can print its message while the counter thread is sleeping.

## Understanding the Global VM Lock (GVL)

Ruby has something called the Global VM Lock (also known as GIL - Global Interpreter Lock). Only one thread can execute Ruby code at a time. It's like having multiple chefs in the kitchen, but only one cutting board they must share.

```ruby
require 'benchmark'

# CPU-intensive task
def fibonacci(n)
  return n if n <= 1
  fibonacci(n - 1) + fibonacci(n - 2)
end

# Single-threaded
time1 = Benchmark.realtime do
  4.times { fibonacci(32) }
end

# Multi-threaded (won't be faster due to GVL)
time2 = Benchmark.realtime do
  threads = 4.times.map do
    Thread.new { fibonacci(32) }
  end
  threads.each(&:join)
end

puts "Single-threaded: #{time1.round(2)}s"
puts "Multi-threaded: #{time2.round(2)}s"
# Single-threaded: 0.67s
# Multi-threaded: 0.64s
# Both take similar time!
```

## When Threads Actually Help

Threads shine when your program is waiting for things - network requests, file I/O, or database queries. During these waits, Ruby releases the GVL, allowing other threads to run.

```ruby
require 'net/http'
require 'json'

urls = [
  'https://api.github.com/users/github',
  'https://api.github.com/users/rails',
  'https://api.github.com/users/ruby'
]

# Single-threaded approach
start = Time.now
results = urls.map do |url|
  response = Net::HTTP.get(URI(url))
  JSON.parse(response)['name']
end
puts "Single-threaded: #{Time.now - start}s"

# Multi-threaded approach
start = Time.now
threads = urls.map do |url|
  Thread.new do
    response = Net::HTTP.get(URI(url))
    JSON.parse(response)['name']
  end
end
results = threads.map(&:value)
puts "Multi-threaded: #{Time.now - start}s"
# Single-threaded: 3.96243s
# Multi-threaded: 1.00214s
# Multi-threaded is significantly faster!
```

## Thread Safety: The Danger Zone

When multiple threads access the same data, race conditions can occur:

```ruby
# DANGER: Race condition!
counter = 0

# Make the race condition visible
threads = 10.times.map do
  Thread.new do
    current = counter
    # Read the value, then pause - another thread might change it!
    sleep(0.001)
    counter = current + 1
  end
end

threads.each(&:join)
puts "Counter should be 10 but is: #{counter}"
# Will be less than 10 - multiple threads read the same value!
```

The fix? Use a Mutex (mutual exclusion):

```ruby
# SAFE: Using a Mutex
counter = 0
mutex = Mutex.new

threads = 10.times.map do
  Thread.new do
    mutex.synchronize do
      current = counter
      sleep(0.001)  # Other threads must wait!
      counter = current + 1
    end
  end
end

threads.each(&:join)
puts "Counter is correctly: #{counter}"  # Always 10
```

## Practical Thread Patterns

### Worker Pool Pattern

When you have many tasks to process, creating a thread for each one is inefficient. A worker pool uses a fixed number of threads to process a queue of work:

```ruby
require 'thread'

work_queue = Queue.new
results = Queue.new

# Add work items
20.times { |i| work_queue << i }

# Create 4 worker threads
workers = 4.times.map do
  Thread.new do
    while (item = work_queue.pop(true) rescue nil)
      result = item ** 2
      sleep(0.1)  # Simulate work
      results << { item: item, result: result }
    end
  end
end

workers.each(&:join)

# Collect results
results.size.times do
  r = results.pop
  puts "#{r[:item]} squared is #{r[:result]}"
end
```

The `Queue` class is thread-safe, so multiple workers can safely pull work items without race conditions.

### Thread-Local Storage

Each thread can store its own private data that other threads can't access:

```ruby
Thread.new do
  Thread.current[:user_id] = 123
  puts "Thread 1 user: #{Thread.current[:user_id]}"
end.join

Thread.new do
  Thread.current[:user_id] = 456
  puts "Thread 2 user: #{Thread.current[:user_id]}"
end.join

puts "Main thread user: #{Thread.current[:user_id]}"  # nil
```

This is useful for storing request-specific data in web servers without passing it through every method call.

## Understanding Thread Lifecycle

A thread goes through several states during its lifetime:

```ruby
thread = Thread.new do
  puts "Thread starting..."
  sleep(2)
  puts "Thread finishing..."
  "Return value"
end

# Thread states:
puts thread.status    # "run" - actively executing
sleep(0.1)
puts thread.status    # "sleep" - waiting (on sleep, I/O, etc.)
thread.join
puts thread.status    # false - terminated normally

# Check if alive
running_thread = Thread.new { loop { sleep 1 } }
dead_thread = Thread.new { "done" }
dead_thread.join

puts running_thread.alive?  # true
puts dead_thread.alive?     # false

# Thread can also terminate with an exception
failing_thread = Thread.new { raise "oops" }
failing_thread.join rescue nil
puts failing_thread.status  # nil - terminated with exception
```

**Thread States:**
- `"run"` - Currently executing
- `"sleep"` - Waiting (blocked on I/O, sleep, or waiting for a resource)
- `"aborting"` - In the process of being killed
- `false` - Terminated normally
- `nil` - Terminated with an exception

## Key Thread Methods

```ruby
thread = Thread.new { sleep(2); "Done!" }

# Check if alive
puts thread.alive?  # true

# Wait with timeout
thread.join(1)  # Wait max 1 second

# Get return value
puts thread.value  # "Done!" (waits if needed)

# Handle exceptions
Thread.abort_on_exception = true
thread = Thread.new do
  raise "Something went wrong!"
end
```

## When to Use Threads

**Use threads for:**
- Multiple API calls
- File I/O operations
- Database queries
- WebSocket connections

**Avoid threads for:**
- CPU-intensive calculations
- Simple sequential tasks
- When complexity outweighs benefits

## What's Next?

Threads are powerful but limited by the GVL. In Part 2, we'll explore Fibers - Ruby's lightweight concurrency primitive that gives you cooperative concurrency and fine-grained control over execution flow. Then in Part 3, we'll dive into Ractors - Ruby 3's answer to true parallel execution without the GVL limitations.

Understanding threads is your foundation for mastering Ruby's evolving concurrency story.

**Stay tuned for Part 2: Ruby Fibers - Mastering Cooperative Concurrency!**

Want to be notified when the next part drops? [Subscribe to the newsletter](#newsletter-section) or follow me on [Twitter](https://x.com/intent/user?screen_name=prateekkish){:target="_blank" rel="noopener noreferrer" aria-label="Follow Prateek on Twitter (opens in new tab)"} for updates.

## References

- [Ruby Thread Documentation](https://ruby-doc.org/3.4.1/Thread.html){:target="_blank" rel="noopener noreferrer" aria-label="Ruby Thread Documentation (opens in new tab)"}
- [Ruby Concurrency and Parallelism Guide](https://www.rubyguides.com/2015/07/ruby-threads/){:target="_blank" rel="noopener noreferrer" aria-label="Ruby Concurrency and Parallelism Guide (opens in new tab)"}