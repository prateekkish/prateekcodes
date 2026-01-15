---
layout: post
title: "Ruby 4.0 Introduces Ruby::Box for In-Process Isolation (Part 1)"
author: prateek
categories: [ Ruby, Ruby 4.0, Isolation ]
tags: [ ruby, ruby-box, namespace, isolation, monkey-patching, ruby-4 ]
excerpt: "Ruby 4.0 introduces Ruby::Box, a new feature that provides isolated namespaces for classes, constants, and global variables within a single Ruby process."
description: "Learn how Ruby 4.0's Ruby::Box feature solves monkey patching conflicts and provides namespace isolation without separate processes."
keywords: "ruby 4.0, ruby box, namespace isolation, monkey patching, ruby isolation, gem conflicts, ruby namespace, in-process isolation"
---

Ruby 4.0 introduces `Ruby::Box`, a feature that provides isolated namespaces within a single Ruby process. This solves a long-standing problem: monkey patches and global modifications from one gem affecting all other code in your application.

## The Problem with Shared Namespaces

When you load a gem that modifies core classes, those changes affect everything in your Ruby process:

```ruby
# Gem A adds a titleize method to String
class String
  def titleize
    split.map(&:capitalize).join(' ')
  end
end

# Now EVERY piece of code in your process sees this method
# Including Gem B, which might have its own expectations

"hello world".titleize  # => "Hello World"
```

This becomes problematic when:

- Two gems define conflicting methods on the same class
- A gem's monkey patch breaks another library's assumptions
- You want to test code in isolation from invasive patches
- You need to run multiple versions of a gem simultaneously

Before Ruby 4.0, the only solutions were separate Ruby processes (with IPC overhead) or containers (with even more overhead).

## Ruby 4.0: Enter Ruby::Box

`Ruby::Box` creates isolated spaces where code runs with its own class definitions, constants, and global variables. Changes made inside a box stay inside that box.

```ruby
# Enable with environment variable at startup
# RUBY_BOX=1 ruby my_script.rb

# Check if Boxing is available
Ruby::Box.enabled?  # => true

# Create an isolated box
box = Ruby::Box.new

# Load code that patches String
box.eval <<~RUBY
  class String
    def shout
      upcase + "!!!"
    end
  end
RUBY

# The patch exists only inside the box
box.eval('"hello".shout')  # => "HELLO!!!"

# Outside the box, String is unchanged
"hello".shout  # => NoMethodError: undefined method `shout'
```

## Understanding Box Types

`Ruby::Box` operates with three types of boxes:

**Root Box**: Contains all built-in Ruby classes and modules. This is established before any user code runs and serves as the template for other boxes.

**Main Box**: Your application's default execution context. It's automatically created from the root box when the process starts. This is where your main script runs.

**User Boxes**: Custom boxes you create with `Ruby::Box.new`. Each is copied from the root box, giving it a clean slate of built-in classes without any modifications from the main box or other user boxes.

```ruby
# Your script runs in the "main" box
Ruby::Box.current  # => #<Ruby::Box main>

# Create isolated boxes
plugin_box = Ruby::Box.new
another_box = Ruby::Box.new

# Each box is independent
plugin_box.object_id != another_box.object_id  # => true
```

## The Ruby::Box API

The API is straightforward with just a few methods:

```ruby
# Creation
box = Ruby::Box.new

# Loading code
box.require('some_library')        # Respects box's $LOAD_PATH
box.require_relative('./my_file')  # Relative to current file
box.load('script.rb')              # Direct file execution

# Executing code
box.eval('1 + 1')                  # Execute Ruby code as string

# Inspection
Ruby::Box.current    # Returns the currently executing box
Ruby::Box.enabled?   # Check if Boxing is active
```

## What Gets Isolated

`Ruby::Box` isolates several aspects of the Ruby runtime:

**Classes and Constants**: Reopening a built-in class in one box doesn't affect other boxes.

```ruby
box = Ruby::Box.new
box.eval <<~RUBY
  class Array
    def sum_squares
      map { |n| n ** 2 }.sum
    end
  end
RUBY

box.eval('[1, 2, 3].sum_squares')  # => 14
[1, 2, 3].sum_squares              # => NoMethodError
```

**Global Variables**: Changes to globals stay within the box.

```ruby
box = Ruby::Box.new
box.eval('$my_config = { debug: true }')

box.eval('$my_config')  # => { debug: true }
$my_config              # => nil
```

**Top-Level Methods**: Methods defined at the top level become private instance methods of `Object` within that box only.

```ruby
box = Ruby::Box.new
box.eval <<~RUBY
  def helper_method
    "I'm only available in this box"
  end
RUBY

box.eval('helper_method')  # => "I'm only available in this box"
helper_method              # => NoMethodError
```

## Enabling Ruby::Box

`Ruby::Box` is disabled by default. Enable it by setting the `RUBY_BOX` environment variable before the Ruby process starts:

```bash
RUBY_BOX=1 ruby my_application.rb
```

> **Important**: Setting `RUBY_BOX` after the process has started has no effect. The boxing infrastructure must be initialized during Ruby's boot sequence, so the variable must be set before the Ruby process starts.

```ruby
# This check should be at the top of your application
unless Ruby::Box.enabled?
  warn "Ruby::Box is not enabled. Start with RUBY_BOX=1"
  exit 1
end
```

## Important Limitations

Before adopting `Ruby::Box`, be aware of these constraints:

**Not a Security Sandbox**: `Ruby::Box` provides namespace isolation, not security isolation. Code in a box can still access the filesystem, network, and system resources. Do not use it to run untrusted code.

**Native Extensions**: Installing gems with native extensions may fail when `RUBY_BOX=1` is set. The workaround is to install gems without the flag, then run your application with it enabled.

```bash
# Install gems normally
bundle install

# Run with Boxing enabled
RUBY_BOX=1 bundle exec ruby app.rb
```

**ActiveSupport Compatibility**: Some parts of `active_support/core_ext` have compatibility issues with `Ruby::Box`. Load `ActiveSupport` in your main context before creating boxes if needed.

**Experimental Status**: This feature is experimental in Ruby 4.0. Behavior may change in future versions. The Ruby core team recommends experimentation but advises caution in production environments.

## File Scope Execution

One important detail: `Ruby::Box` operates on a file-scope basis. Each `.rb` file executes entirely within a single box. Once loaded, all methods and procs defined in that file operate within their originating box, regardless of where they're called from.

```ruby
# helper.rb
def process(data)
  # This method always runs in the box where helper.rb was loaded
  data.transform
end

# main.rb
box = Ruby::Box.new
box.require_relative('helper')

# Even when called from main, process() runs in box's context
box.eval('process(my_data)')
```

`Ruby::Box` brings a long-requested capability to Ruby: proper namespace isolation without process boundaries. In [Part 2](/ruby-4-ruby-box-practical-guide-part-2/), we'll explore practical use cases including plugin systems, multi-tenant configurations, and strategies for gradual adoption.

## References

- [Ruby::Box Official Documentation](https://docs.ruby-lang.org/en/master/Ruby/Box.html){:target="_blank" rel="noopener noreferrer" aria-label="Ruby::Box official documentation (opens in new tab)"}
- [Ruby 4.0.0 Release Notes](https://www.ruby-lang.org/en/news/2025/12/25/ruby-4-0-0-released/){:target="_blank" rel="noopener noreferrer" aria-label="Ruby 4.0.0 release announcement (opens in new tab)"}
- [Ruby::Box Introduction by ko1](https://dev.to/ko1/rubybox-digest-introduction-ruby-400-new-feature-3bch){:target="_blank" rel="noopener noreferrer" aria-label="ko1's Ruby::Box introduction on DEV.to (opens in new tab)"}
- [Ruby 4.0 Changes Documentation](https://rubyreferences.github.io/rubychanges/4.0.html){:target="_blank" rel="noopener noreferrer" aria-label="Ruby 4.0 changes reference (opens in new tab)"}
