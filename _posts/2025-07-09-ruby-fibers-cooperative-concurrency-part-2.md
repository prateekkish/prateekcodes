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

{% include mermaid.html %}

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


### Preemptive Scheduling (Threads)

<div class="mermaid">
flowchart TB
    OS["Operating System Scheduler"]
    T1["Thread 1<br/>Running"]
    T2["Thread 2<br/>Waiting"]
    T3["Thread 3<br/>Waiting"]
    
    OS -->|"Decides when<br/>to switch"| T1
    OS -.->|"Next up"| T2
    OS -.->|"In queue"| T3
    
    T1 -->|"Time slice expires<br/>or I/O wait"| OS
    T2 -->|"Gets CPU time"| OS
    T3 -->|"Waits for turn"| OS
    
    Note1["OS interrupts threads at any time<br/>Developer has no control over switching<br/>Context switches happen automatically"]
    
    T1 -.-> Note1
    
    classDef osStyle fill:#ff9999,stroke:#cc0000,stroke-width:3px,color:#fff
    classDef threadRunning fill:#99ff99,stroke:#00aa00,stroke-width:2px
    classDef threadWaiting fill:#cccccc,stroke:#666666,stroke-width:2px
    classDef noteStyle fill:#fff9e6,stroke:#cc9900,stroke-dasharray: 5 5
    
    class OS osStyle
    class T1 threadRunning
    class T2,T3 threadWaiting
    class Note1 noteStyle
</div>

### Cooperative Scheduling (Fibers)

<div class="mermaid">
flowchart TB
    Code["Your Code<br/>(Main Fiber)"]
    F1["Fiber 1<br/>Running"]
    F2["Fiber 2<br/>Paused"]
    F3["Fiber 3<br/>Paused"]
    
    Code -->|"fiber1.resume"| F1
    F1 -->|"Fiber.yield"| Code
    Code -.->|"fiber2.resume<br/>(when ready)"| F2
    Code -.->|"fiber3.resume<br/>(when ready)"| F3
    
    F2 -.->|"Fiber.yield<br/>(when resumed)"| Code
    F3 -.->|"Fiber.yield<br/>(when resumed)"| Code
    
    Note2["Fibers yield control voluntarily<br/>Developer decides exactly when to switch<br/>No unexpected interruptions"]
    
    Code -.-> Note2
    
    classDef codeStyle fill:#99ccff,stroke:#0066cc,stroke-width:3px,color:#fff
    classDef fiberRunning fill:#99ff99,stroke:#00aa00,stroke-width:2px
    classDef fiberPaused fill:#ffcc99,stroke:#ff6600,stroke-width:2px
    classDef noteStyle fill:#f0f9ff,stroke:#0066cc,stroke-dasharray: 5 5
    
    class Code codeStyle
    class F1 fiberRunning
    class F2,F3 fiberPaused
    class Note2 noteStyle
</div>

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

<div class="mermaid">
sequenceDiagram
    participant Main as Main Program
    participant Fiber as Greeting Fiber
    
    Main->>Fiber: resume()
    activate Fiber
    Fiber->>Fiber: puts "Hello"
    Fiber->>Main: Fiber.yield
    deactivate Fiber
    
    Main->>Main: puts "Doing other work..."
    
    Main->>Fiber: resume()
    activate Fiber
    Fiber->>Fiber: puts "How are you?"
    Fiber->>Main: Fiber.yield
    deactivate Fiber
    
    Main->>Main: puts "More work..."
    
    Main->>Fiber: resume()
    activate Fiber
    Fiber->>Fiber: puts "Goodbye!"
    Fiber->>Main: (fiber ends)
    deactivate Fiber
</div>

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

## Checking Fiber State with alive?

You can check if a fiber has finished executing or can still be resumed:

```ruby
require 'fiber'  # Required for alive? method

counter = Fiber.new do
  3.times do |i|
    puts "Count: #{i}"
    Fiber.yield
  end
  "Done counting!"
end

puts counter.alive?  # true - fiber just created
counter.resume       # Count: 0
puts counter.alive?  # true - fiber yielded, can resume

counter.resume       # Count: 1
counter.resume       # Count: 2
result = counter.resume  # Returns "Done counting!"

puts counter.alive?  # false - fiber completed
puts result          # "Done counting!"

# Trying to resume a dead fiber
begin
  counter.resume
rescue FiberError => e
  puts "Error: #{e.message}"  # Error: attempt to resume a terminated fiber
end
```

The `alive?` method is particularly useful when working with producer-consumer patterns or when you need to check if a fiber has more work to do before attempting to resume it.

## The Fiber Scheduler: Non-Blocking I/O Magic

Ruby 3.0 introduced the Fiber Scheduler API, enabling non-blocking I/O operations without callbacks. The key insight is that Ruby doesn't provide a default scheduler implementation - you need to use a gem like `async` or implement the scheduler interface yourself.

### The Scheduler Interface

To create a Fiber Scheduler, you must implement these methods:

```ruby
class MyScheduler
  # Called when a fiber needs to wait for I/O
  def io_wait(io, events, timeout)
    # events can be :r (readable), :w (writable), or :rw
  end
  
  # Called when a fiber calls sleep
  def kernel_sleep(duration = nil)
    # Handle sleep without blocking other fibers
  end
  
  # Called when a fiber blocks (e.g., waiting for a mutex)
  def block(blocker, timeout = nil)
    # Handle blocking operations
  end
  
  # Called when a blocked fiber can continue
  def unblock(blocker, fiber)
    # Resume the previously blocked fiber
  end
  
  # Called when the scheduler is being shut down
  def close
    # Clean up resources
  end
end
```

The scheduler is what enables the non-blocking behavior - when a fiber would normally block on I/O, the scheduler receives control and can switch to another fiber instead.

### Using a Scheduler

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
    sleep(1)  # Non-blocking with scheduler
    puts "Slept for 1 second"
  end
end
```

### Understanding blocking: false Parameter

The `blocking: false` parameter tells Ruby to use non-blocking I/O operations when a Fiber Scheduler is set:

```ruby
require 'io/nonblock'
require 'async'

# Without Fiber Scheduler - blocking: false raises error
begin
  socket = TCPSocket.new('example.com', 80)
  socket.nonblock = true
  # This would raise Errno::EWOULDBLOCK without a scheduler
  socket.read_nonblock(1024)
rescue IO::WaitReadable
  puts "Would block - no data available yet"
end

# With Fiber Scheduler - blocking: false works seamlessly
Async do
  socket = TCPSocket.new('example.com', 80)
  
  # With scheduler, this automatically yields fiber instead of blocking
  data = socket.read(1024, blocking: false)
  puts "Received: #{data.bytesize} bytes"
end
```

**Note:** Starting with Ruby 3.0, sockets created within a Fiber Scheduler context default to non-blocking mode automatically. You don't need to explicitly set `blocking: false` for most operations - Ruby handles it for you when a scheduler is active.

## Practical Fiber Patterns

### Lazy File Reading with Fibers and Enumerators

Fibers work beautifully with Ruby's Enumerator class for lazy evaluation of large files:

```ruby
# Lazy file reading with Fibers
def lazy_file_reader(filename)
  Fiber.new do
    File.foreach(filename) do |line|
      Fiber.yield line.chomp
    end
  end
end

# Usage - reads file line by line, only when needed
reader = lazy_file_reader('large_log_file.txt')

# Process first 10 lines without loading entire file
10.times do
  line = reader.resume
  break unless line  # Stop if file has fewer than 10 lines
  puts "Processing: #{line}"
end

# Even better - wrap in an Enumerator for Ruby idioms
def lazy_file_enumerator(filename)
  Enumerator.new do |yielder|
    fiber = Fiber.new do
      File.foreach(filename) do |line|
        Fiber.yield line.chomp
      end
    end
    
    while fiber.alive?
      if line = fiber.resume
        yielder << line
      end
    end
  end
end

# Now you can use all Enumerable methods!
lines = lazy_file_enumerator('server.log')
lines.select { |line| line.include?('ERROR') }
     .first(5)
     .each { |error| puts "Found error: #{error}" }
```

This pattern is memory-efficient for processing large files since it only reads one line at a time into memory.

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
  require 'fiber'  # For alive? method
  
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

**Note:** While this example demonstrates fiber state management, in a real application you'd want to use a proper scheduler (like the Async gem) to handle the sleep operations non-blocking. Without a scheduler, the sleep calls still block the entire thread.

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
# Threads use significantly more memory
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

## Fiber Gotchas and Error Handling

### Common Fiber Errors

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

### Proper Error Handling Patterns

Always wrap fiber operations in proper error handling:

```ruby
require 'fiber'

# Pattern 1: Safe fiber execution with error recovery
def safe_fiber_execute(fiber)
  begin
    if fiber.alive?
      fiber.resume
    else
      puts "Fiber already completed"
      nil
    end
  rescue FiberError => e
    puts "Fiber error: #{e.message}"
    nil
  rescue => e
    puts "Unexpected error in fiber: #{e.message}"
    raise  # Re-raise unexpected errors
  end
end

# Pattern 2: Fiber with internal error handling
error_prone_fiber = Fiber.new do
  begin
    puts "Starting risky operation"
    result = 10 / 0  # Will raise ZeroDivisionError
    Fiber.yield(result)
  rescue ZeroDivisionError => e
    Fiber.yield(error: "Division by zero!")
  rescue => e
    Fiber.yield(error: "Unexpected: #{e.message}")
  end
end

result = error_prone_fiber.resume
if result.is_a?(Hash) && result[:error]
  puts "Fiber reported error: #{result[:error]}"
end

# Pattern 3: Propagating errors from fibers
class FiberWithErrors
  def initialize(&block)
    @fiber = Fiber.new do
      begin
        block.call
      rescue => e
        Fiber.yield(error: e)  # Pass error back to caller
        raise  # Re-raise after yielding
      end
    end
  end

  def resume(*args)
    result = @fiber.resume(*args)
    
    # Check if fiber returned an error
    if result.is_a?(Hash) && result[:error]
      raise result[:error]
    end
    
    result
  end
  
  def alive?
    @fiber.alive?
  end
end

# Usage
managed_fiber = FiberWithErrors.new do
  puts "Doing work..."
  raise "Something went wrong!"
end

begin
  managed_fiber.resume
rescue => e
  puts "Caught error from fiber: #{e.message}"
end
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

The key difference: with `yield/resume`, control always returns to the caller. With `transfer`, you explicitly choose which fiber gets control next, creating a peer-to-peer relationship rather than a parent-child one.

<div class="mermaid">
flowchart TB
    subgraph "Fiber.yield/resume (Parent-Child)"
        direction TB
        Main1["Main Fiber<br/>(Parent)"] 
        F1["Fiber 1<br/>(Child)"]
        F2["Fiber 2<br/>(Child)"]
        
        Main1 -->|"resume"| F1
        F1 -->|"yield"| Main1
        Main1 -->|"resume"| F2
        F2 -->|"yield"| Main1
        
        style Main1 fill:#e1f5fe
        style F1 fill:#fff3e0
        style F2 fill:#f3e5f5
    end
    
    subgraph "Fiber.transfer (Peer-to-Peer)"
        direction TB
        Main2["Main Fiber"]
        F3["Fiber 1"]
        F4["Fiber 2"]
        
        Main2 -->|"transfer"| F3
        F3 -->|"transfer"| F4
        F4 -->|"transfer"| F3
        F3 -->|"transfer"| Main2
        
        style Main2 fill:#e1f5fe
        style F3 fill:#fff3e0
        style F4 fill:#f3e5f5
    end
    
    Note1["Control always returns<br/>to parent with yield"]
    Note2["Control goes to any<br/>fiber with transfer"]
    
    Note1 -.-> Main1
    Note2 -.-> F4
</div>

Here's a more detailed example showing the control flow difference:

```ruby
# yield/resume example - parent-child relationship
puts "=== Yield/Resume Example ==="
main_fiber = Fiber.current

child = Fiber.new do
  puts "Child: Started"
  Fiber.yield "value-from-child"  # Returns to parent
  puts "Child: Resumed by parent"
  "final-value"
end

puts "Main: Starting child"
value = child.resume
puts "Main: Got '#{value}' from child"
final = child.resume
puts "Main: Child finished with '#{final}'"

# transfer example - peer-to-peer relationship
puts "\n=== Transfer Example ==="
fiber_a = nil
fiber_b = nil

fiber_a = Fiber.new do
  puts "A: Started"
  fiber_b.transfer("hello-from-a")  # Control to B, not back to main
  puts "A: Got control back from B"
  Fiber.current.transfer("done-from-a")  # Back to whoever called us
end

fiber_b = Fiber.new do |msg|
  puts "B: Started with message '#{msg}'"
  fiber_a.transfer  # Control to A, not back to main
  puts "B: This never executes!"
end

result = fiber_a.transfer
puts "Main: Got '#{result}'"
```

This enables more complex coordination patterns but requires careful management to avoid getting stuck.

## The Reality Check

While Fibers are powerful, they come with caveats:
- Limited ecosystem support compared to threads
- Debugging can be challenging with complex fiber interactions
- The Fiber Scheduler API (CRuby 3.0+) is still evolving
- Some database drivers (e.g., mysql2 without async support) and third-party gems may not support the Fiber Scheduler API yet

For many applications, threads remain the pragmatic choice despite their limitations.

## What's Next?

Fibers give us lightweight concurrency with precise control, perfect for I/O-bound operations. But what if we need true parallelism across CPU cores? 

Continue the series:
- **[Part 1: Threads](/ruby-threads-explained-simple-guide-part-1/)** - Understanding Ruby threads and the GVL
- **[Part 3: Ractors](/ruby-ractors-true-parallelism-part-3/)** - Ruby's ambitious but controversial feature for parallelism in CRuby
- **[Part 4: Beyond CRuby](/ruby-multithreading-beyond-cruby-part-4/)** - How JRuby and TruffleRuby deliver true parallel threads

While Fibers excel at cooperative concurrency within a single thread, the journey to true parallelism takes two different paths: Ractors for CRuby users, or switching to JRuby/TruffleRuby for immediate parallel execution.

---

Enjoying this Ruby concurrency series? Subscribe to get notified about more deep-dives into Ruby performance and optimization.

## References

- [Ruby Fiber Documentation](https://ruby-doc.org/3.4.1/Fiber.html){:target="_blank" rel="noopener noreferrer" aria-label="Ruby Fiber Documentation (opens in new tab)"}
- [Async Ruby Gem](https://github.com/socketry/async){:target="_blank" rel="noopener noreferrer" aria-label="Async Ruby gem on GitHub (opens in new tab)"}
- [Fiber Scheduler Interface](https://github.com/ruby/ruby/blob/master/doc/fiber.md#scheduler){:target="_blank" rel="noopener noreferrer" aria-label="Ruby Fiber Scheduler interface documentation on GitHub (opens in new tab)"}