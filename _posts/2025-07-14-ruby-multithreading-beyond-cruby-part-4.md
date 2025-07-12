---
layout: post
title: "Beyond CRuby: True Parallel Ruby with JRuby and TruffleRuby (Part 4)"
author: prateek
categories: [ Ruby, Concurrency, Threading ]
tags: [ ruby, jruby, truffleruby, threads, multithreading, parallel-processing, concurrency ]
excerpt: "Discover Ruby implementations that offer true parallel threading. Learn how JRuby and TruffleRuby break free from the GVL to deliver real concurrent execution."
description: "Explore alternative Ruby implementations like JRuby and TruffleRuby that provide true parallel threading without the Global VM Lock. See practical examples of multi-core utilization and performance gains."
keywords: "jruby threads, truffleruby parallel, ruby true parallelism, jruby multithreading, truffleruby concurrency, ruby without GVL, parallel ruby execution, jruby performance"
---

Throughout this series, we've explored CRuby's concurrency model - threads limited by the GVL, cooperative Fibers, and isolated Ractors. But what if you could have threads that truly run in parallel across multiple CPU cores?

## Breaking Free from the GVL

While CRuby implements the Global VM Lock for thread safety, Ruby the language doesn't mandate this. Alternative Ruby implementations can and do provide true parallel threading:

- **JRuby**: Ruby on the Java Virtual Machine with real parallel threads
- **TruffleRuby**: High-performance Ruby with parallel execution via GraalVM

Let's explore how these implementations deliver the parallelism that CRuby can't.

## JRuby: Ruby on the JVM

JRuby runs Ruby code on the Java Virtual Machine, leveraging Java's mature threading model. This means threads in JRuby are actual OS threads that can execute Ruby code simultaneously.

> "JRuby has been used in production applications for almost 20 years, providing parallel execution of code along with leading-edge JIT and GC from the JVM. Rails apps on JRuby can power a whole site with a single process, saving users time and money when scaling up."
>
> — Charles Oliver Nutter (headius), JRuby Lead Developer

### Setting Up JRuby

First, ensure you have Java installed (JRuby requires Java 8 or higher):

```bash
# Check Java version
java -version

# Install Java if needed (macOS example)
brew install openjdk@21
```

Then install JRuby:

```bash
# Using mise
mise install ruby@jruby-10.0.0.1
mise use ruby@jruby-10.0.0.1

# Using rbenv
rbenv install jruby-10.0.0.1
rbenv local jruby-10.0.0.1

# Or using RVM
rvm install jruby-10.0.0.1
rvm use jruby-10.0.0.1
```

### True Parallel Execution

Remember our CPU-intensive Fibonacci example from [Part 1](/ruby-threads-explained-simple-guide-part-1/)? Let's see how it performs with JRuby:

```ruby
require 'benchmark'

def fibonacci(n)
  return n if n <= 1
  fibonacci(n - 1) + fibonacci(n - 2)
end

# Single-threaded
time1 = Benchmark.realtime do
  4.times { fibonacci(35) }
end

# Multi-threaded
time2 = Benchmark.realtime do
  threads = 4.times.map do
    Thread.new { fibonacci(35) }
  end
  threads.each(&:join)
end

puts "Single-threaded: #{time1.round(2)}s"
puts "Multi-threaded: #{time2.round(2)}s"
puts "Speedup: #{(time1/time2).round(2)}x"
```

With JRuby, the multi-threaded version can utilize multiple CPU cores simultaneously, unlike CRuby where threads are limited by the GVL.

### Thread Safety Becomes Critical

With real parallelism comes real danger. Race conditions that might be hidden in CRuby become visible in JRuby:

```ruby
# This code is MORE dangerous in JRuby!
counter = 0

threads = 100.times.map do
  Thread.new do
    1000.times do
      counter += 1  # Multiple threads REALLY access this simultaneously
    end
  end
end

threads.each(&:join)
puts "Counter: #{counter}"

# CRuby: Often gets close to 100,000 (GVL provides some protection)
# JRuby: Counter: 68371 (or similar) - real race conditions!
```

Always use proper synchronization in JRuby:

```ruby
require 'thread'
counter = 0
mutex = Mutex.new

threads = 100.times.map do
  Thread.new do
    1000.times do
      mutex.synchronize { counter += 1 }
    end
  end
end

threads.each(&:join)
puts "Counter: #{counter}"  # Always 100,000
```

### JRuby-Specific Features

JRuby provides additional concurrency tools from the Java ecosystem. You can leverage Java's battle-tested concurrent data structures and atomic operations directly from Ruby code, eliminating the need for manual mutex management in many cases:

```ruby
# Using Java's concurrent data structures
require 'java'
java_import 'java.util.concurrent.ConcurrentHashMap'
java_import 'java.util.concurrent.atomic.AtomicInteger'

# Thread-safe hash without explicit locking
safe_hash = ConcurrentHashMap.new

threads = 10.times.map do |i|
  Thread.new do
    1000.times do |j|
      safe_hash.put("thread_#{i}_item_#{j}", j * i)
    end
  end
end

threads.each(&:join)
puts "Hash size: #{safe_hash.size}"  # Always 10,000

# Atomic operations
counter = AtomicInteger.new(0)

threads = 100.times.map do
  Thread.new do
    1000.times { counter.increment_and_get }
  end
end

threads.each(&:join)
puts "Atomic counter: #{counter.get}"  # Always 100,000
```

### Leveraging Java Thread Pools

Java's `ExecutorService` provides sophisticated thread pool management with built-in queuing, scheduling, and lifecycle control. This example shows how to efficiently process multiple tasks using a fixed-size thread pool instead of creating threads manually:

```ruby
require 'java'
java_import 'java.util.concurrent.Executors'

# Create a fixed thread pool
executor = Executors.new_fixed_thread_pool(4)

# Submit tasks
futures = 20.times.map do |i|
  executor.submit do
    result = fibonacci(30)
    puts "Task #{i} completed: #{result}"
    result
  end
end

# Get results
results = futures.map(&:get)
executor.shutdown

puts "All tasks completed. Sum: #{results.sum}"
```

## TruffleRuby: High-Performance Polyglot Ruby

TruffleRuby, built on GraalVM, offers not just parallel threads but also advanced JIT compilation and polyglot capabilities.

### Setting Up TruffleRuby

```bash
# Using mise
mise install ruby@truffleruby
mise use ruby@truffleruby

# Using rbenv
rbenv install truffleruby
rbenv local truffleruby

# Or download directly
# Visit: https://github.com/oracle/truffleruby/releases
```

### Parallel Performance

TruffleRuby threads behave similarly to JRuby - true parallel execution. This example shows how parallel threads can utilize multiple CPU cores for CPU-intensive operations like matrix multiplication:

```ruby
require 'benchmark'

# Matrix multiplication - CPU intensive
def matrix_multiply(size)
  a = Array.new(size) { Array.new(size) { rand } }
  b = Array.new(size) { Array.new(size) { rand } }
  c = Array.new(size) { Array.new(size, 0) }

  size.times do |i|
    size.times do |j|
      size.times do |k|
        c[i][j] += a[i][k] * b[k][j]
      end
    end
  end
  c
end

# Parallel matrix operations
matrices = 8.times.map { 100 }

time1 = Benchmark.realtime do
  matrices.map { |size| matrix_multiply(size) }
end

time2 = Benchmark.realtime do
  threads = matrices.map do |size|
    Thread.new { matrix_multiply(size) }
  end
  threads.map(&:value)
end

puts "Sequential: #{time1.round(2)}s"
puts "Parallel: #{time2.round(2)}s"
puts "Speedup: #{(time1/time2).round(2)}x"
```

### TruffleRuby's Polyglot Features

One of TruffleRuby's unique advantages is its ability to seamlessly interoperate with other GraalVM languages like JavaScript, Python, and Java. This enables you to leverage libraries from different ecosystems within a single Ruby application:

```ruby
# Access JavaScript from Ruby
js_array = Polyglot.eval('js', '[1, 2, 3, 4, 5]')
js_array.each { |n| puts n * 2 }

# Use Java classes
Polyglot.eval('java', 'java.util.concurrent.ConcurrentLinkedQueue').new

# Share objects between languages
ruby_proc = proc { |x| x * 2 }
Polyglot.export('double_func', ruby_proc)

# JavaScript can now use the Ruby proc
result = Polyglot.eval('js', 'Polyglot.import("double_func")(21)')
puts result  # 42
```

## Practical Patterns for Parallel Ruby

### CPU-Bound Work Distribution

When you have CPU-intensive work to distribute across multiple cores, this pattern creates an optimal number of threads based on available processors and divides the work evenly among them:

```ruby
# Works efficiently in JRuby/TruffleRuby
def parallel_map(array, &block)
  # Determine optimal thread count
  thread_count = [array.size, Etc.nprocessors].min
  slice_size = (array.size / thread_count.to_f).ceil

  threads = array.each_slice(slice_size).map do |slice|
    Thread.new { slice.map(&block) }
  end

  threads.flat_map(&:value)
end

# Process data in parallel
numbers = (1..1000).to_a
results = parallel_map(numbers) { |n| n ** 2 }
```

### Parallel File Processing

This pattern demonstrates a worker pool approach for processing multiple files in parallel. It uses thread-safe queues to coordinate work distribution and result collection, making it ideal for batch processing tasks:

```ruby
require 'thread'

def parallel_file_processor(files, workers: 4)
  queue = Queue.new
  results = Queue.new

  # Add all files to queue
  files.each { |f| queue << f }

  # Create worker threads
  threads = workers.times.map do
    Thread.new do
      while (file = queue.pop(true) rescue nil)
        result = process_file(file)
        results << { file: file, result: result }
      end
    end
  end

  threads.each(&:join)

  # Collect results
  output = {}
  results.size.times do
    r = results.pop
    output[r[:file]] = r[:result]
  end
  output
end

def process_file(file)
  # Simulate CPU-intensive processing
  content = File.read(file)
  content.split.map(&:upcase).uniq.sort
end
```

## Choosing the Right Implementation

### When to Use JRuby

- **Java integration needed** - Access to Java libraries and frameworks
- **CPU-intensive workloads** - Scientific computing, data processing
- **Existing Java infrastructure** - Deploy Ruby in Java environments
- **Mature threading model** - Proven, stable parallel execution

### When to Use TruffleRuby

- **Polyglot applications** - Mix Ruby with JavaScript, Python, Java
- **Advanced optimizations** - Sophisticated JIT compilation
- **Research/experimentation** - Cutting-edge VM technology
- **C extension compatibility** - Better than JRuby for many gems

### When to Stick with CRuby

- **Gem compatibility** - Best support for the Ruby ecosystem
- **Deployment simplicity** - Widely supported, well-understood
- **I/O-bound workloads** - GVL released during I/O operations
- **Lower memory usage** - Generally uses less memory than JVM-based implementations

## Migration Considerations

### Thread Safety Audit

Moving from CRuby to JRuby/TruffleRuby requires careful review of your code. Race conditions that might be masked by the GVL in CRuby will become real bugs in truly parallel implementations:

```ruby
# CRuby - might work due to GVL
class Counter
  attr_accessor :value

  def initialize
    @value = 0
  end

  def increment
    @value += 1  # NOT thread-safe in JRuby/TruffleRuby
  end
end

# JRuby/TruffleRuby - proper synchronization required
class SafeCounter
  def initialize
    @value = 0
    @mutex = Mutex.new
  end

  def increment
    @mutex.synchronize { @value += 1 }
  end

  def value
    @mutex.synchronize { @value }
  end
end
```

### Gem Compatibility

Not all gems work across all Ruby implementations, especially those with C extensions. Use platform-specific gems in your Gemfile to handle compatibility:

```ruby
# In your Gemfile
platforms :jruby do
  gem 'jdbc-postgres'  # JRuby-specific database driver
end

platforms :mri do
  gem 'pg'  # CRuby-specific gem
end
```

## Conclusion

JRuby and TruffleRuby demonstrate that Ruby can support true parallel thread execution. While CRuby's GVL simplifies thread safety, these alternative implementations show what's possible when threads can genuinely run in parallel.

The choice of implementation depends on your needs:
- **CRuby** for compatibility and simplicity
- **JRuby** for Java integration and stable parallelism
- **TruffleRuby** for advanced optimizations and polyglot capabilities

Understanding these options empowers you to choose the right tool for your concurrent Ruby applications. The GVL isn't a limitation of Ruby - it's an implementation choice that you can opt out of when true parallelism matters.

---

This concludes our Ruby Multithreading series! We've journeyed from understanding [CRuby's threads and the GVL](/ruby-threads-explained-simple-guide-part-1/), through [cooperative concurrency with Fibers](/ruby-fibers-cooperative-concurrency-part-2/), to [true parallelism with Ractors](/ruby-ractors-true-parallelism-part-3/), and finally explored alternative Ruby implementations that break free from the GVL entirely.

If you found this series helpful, consider subscribing to stay updated on more Ruby deep-dives and performance optimization content.

## Acknowledgments

Special thanks to Charles Oliver Nutter ([headius](https://github.com/headius){:target="_blank" rel="noopener noreferrer" aria-label="headius github account (opens in new tab)"}), JRuby's lead developer, for reviewing this post and providing valuable feedback to ensure technical accuracy.

## References

- [JRuby Documentation](https://www.jruby.org/documentation){:target="_blank" rel="noopener noreferrer" aria-label="JRuby Documentation (opens in new tab)"}
- [TruffleRuby Documentation](https://www.graalvm.org/latest/reference-manual/ruby/){:target="_blank" rel="noopener noreferrer" aria-label="TruffleRuby Documentation (opens in new tab)"}
- [GraalVM Polyglot Programming](https://www.graalvm.org/latest/reference-manual/polyglot-programming/){:target="_blank" rel="noopener noreferrer" aria-label="GraalVM Polyglot Programming guide (opens in new tab)"}
- [JRuby Performance Tuning](https://github.com/jruby/jruby/wiki/PerformanceTuning){:target="_blank" rel="noopener noreferrer" aria-label="JRuby Performance Tuning guide (opens in new tab)"}