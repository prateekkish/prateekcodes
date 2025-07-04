---
layout: post
title: "What's New in Ruby 3.5 Preview"
author: prateek
categories: [ Ruby, Ruby 3.5 ]
tags: [ ruby, ruby-3-5, preview, features, updates ]
excerpt: "Ruby 3.5 preview brings Ractor::Port for better concurrency, Set as a core class, and simplified nil splat behavior"
description: "Explore Ruby 3.5 preview features including Set promotion to core class, new Ractor::Port for synchronization, IO.select infinity support, and important compatibility changes developers need to know"
keywords: "ruby 3.5, ruby 3.5 preview, ruby 3.5 features, Set core class, Ractor Port, nil splat operator, ruby updates"
---

Ruby 3.5.0 preview1 was released on April 18, 2025. While this is just a preview release and not recommended for production use, it gives us a glimpse of what's coming in the final Ruby 3.5 release.

## Set Becomes a Core Class

Ruby 3.5 promotes `Set` from a stdlib class to a core class. Previously, Set was implemented in Ruby using Hash internally. The new core implementation is written in C and uses a custom hash table structure optimized for Set operations, which stores only keys without the unnecessary values that Hash requires.

```ruby
# No functional changes for users
set = Set.new([1, 2, 3])
set.add(4)
set.include?(2)  # => true
```

This change brings performance improvements for most Set operations and reduces memory usage by about 33% for large sets.

## Ractor Gets Major Updates with Ractor::Port

Ruby 3.5 introduces `Ractor::Port` for better synchronization between Ractors, while removing several existing methods.

### New Ractor::Port
```ruby
# Create a port for communication
port = Ractor::Port.new

# Producer Ractor sends data through the port
producer = Ractor.new(port) do |port|
  5.times do |i|
    data = { id: i, value: i * 10 }
    port.send(data)
    sleep(0.1)
  end
  port.send(:done)
end

# Consumer Ractor receives data from the port
consumer = Ractor.new(port) do |port|
  loop do
    msg = port.recv
    break if msg == :done
    puts "Received: #{msg}"
  end
end

# Wait for both to complete
producer.join
consumer.join
```

### New Ractor Methods
Ruby 3.5 adds new methods for better Ractor control:
- `Ractor#join` - Wait for a Ractor to finish execution
- `Ractor#value` - Get the return value of a Ractor

### Removed Ractor Methods
The following methods have been removed:
- `Ractor.yield`
- `Ractor#take`
- `Ractor.select`
- `Ractor#close_incoming`
- `Ractor#close_outgoing`

### Migrating from Old Ractor API

If you have existing code using `Ractor.yield` and `take`, here's how to migrate:

#### Before (Ruby 3.4)
```ruby
# Worker Ractor that yields results
worker = Ractor.new do
  10.times do |i|
    result = i ** 2
    Ractor.yield(result)  # Send result to parent
  end
end

# Main Ractor takes results
10.times do
  value = worker.take  # Receive from worker
  puts "Got: #{value}"
end
```

#### After (Ruby 3.5)
```ruby
# Create a port for communication
port = Ractor::Port.new

# Worker Ractor sends through port
worker = Ractor.new(port) do |port|
  10.times do |i|
    result = i ** 2
    port.send(result)  # Send result through port
  end
end

# Main thread receives from port
10.times do
  value = port.recv  # Receive from port
  puts "Got: #{value}"
end
```

**Developer Action Required**: Replace `Ractor.yield` with `port.send` and `ractor.take` with `port.recv` using the new `Ractor::Port` API.

## Simplified nil Splat Behavior

Ruby 3.5 makes splat operator behavior with `nil` more consistent.

### Before Ruby 3.5
```ruby
def process(*args)
  p args
end

# This would call nil.to_a internally
process(*nil)  # => []
```

### Ruby 3.5
```ruby
def process(*args)
  p args
end

# No longer calls nil.to_a
process(*nil)  # => []

# Consistent with double splat
def options(**opts)
  p opts
end

options(**nil)  # => {} (already worked this way)
```

## IO.select Gets Infinity Support

`IO.select` now accepts `Float::INFINITY` as a timeout argument for cases where you want to wait indefinitely.

```ruby
# Wait forever for IO to be ready
ready = IO.select([socket], nil, nil, Float::INFINITY)
```

## Binding Changes for Numbered Parameters

Numbered parameters (`_1`, `_2`, etc.) are no longer included in binding introspection.

```ruby
[1, 2, 3].map { binding.local_variables }
# Before: [:_1]
# Ruby 3.5: []

[1, 2, 3].map { binding.local_variable_get(:_1) }
# Ruby 3.5: raises NameError
```

This change makes numbered parameters truly anonymous. If you're using numbered parameters, consider migrating to the cleaner `it` parameter introduced in [Ruby 3.4](/ruby-3-4-it-parameter-cleaner-block-syntax/):

```ruby
# Instead of numbered parameters
users.map { _1.name }

# Use the it parameter
users.map { it.name }
```

## Custom Inspect with instance_variables_to_inspect

`Kernel#inspect` now supports customizing which instance variables are shown.

```ruby
class User
  def initialize
    @id = 1
    @password = "secret"
    @email = "user@example.com"
  end

  def instance_variables_to_inspect
    [:@id, :@email]  # Don't show @password
  end
end

User.new.inspect
# => #<User:0x... @id=1, @email="user@example.com">
```

## Socket Gets Connection Timeout

`Socket.tcp` adds an `open_timeout` keyword argument for connection timeouts.

```ruby
# Timeout connection attempt after 5 seconds
Socket.tcp("example.com", 80, open_timeout: 5) do |socket|
  socket.puts "GET / HTTP/1.0\r\n\r\n"
  puts socket.read
end
```

## Default Gems Updates

Several gems have been updated to newer versions as default gems:
- ostruct 0.6.2
- pstore 0.2.0
- benchmark 0.4.1
- logger 1.7.0

These are bundled with Ruby, so you don't need to add them to your Gemfile.

## Important Removals

### CGI Library Mostly Removed
Most of the CGI library has been removed, keeping only escape/unescape methods. If you need full CGI functionality, add the `cgi` gem to your Gemfile.

### SortedSet No Longer Autoloaded
`SortedSet` is no longer available by default when requiring `set`.

```ruby
# This no longer works in Ruby 3.5
require 'set'
sorted = SortedSet.new([3, 1, 2])

# Install the sorted_set gem instead
# gem 'sorted_set'
require 'sorted_set'
sorted = SortedSet.new([3, 1, 2])
```

**Developer Action Required**: Add `gem 'sorted_set'` to your Gemfile if you use SortedSet.

## Testing Your Application

Since this is a preview release, now is the perfect time to test your applications for compatibility. You can install Ruby 3.5.0-preview1 and run your test suite to identify any issues before the final release.

Ruby 3.5 continues the tradition of improving developer experience with better concurrency primitives like Ractor::Port, performance optimizations, and cleaner language semantics, while maintaining strong backwards compatibility for most applications.

## References
- [Ruby 3.5.0 preview1 announcement](https://www.ruby-lang.org/en/news/2025/04/18/ruby-3-5-0-preview1-released/){:target="_blank" rel="noopener noreferrer" aria-label="Ruby 3.5.0 preview1 official announcement (opens in new tab)"}
- [Ruby NEWS.md](https://github.com/ruby/ruby/blob/master/NEWS.md){:target="_blank" rel="noopener noreferrer" aria-label="Ruby NEWS.md on GitHub (opens in new tab)"}