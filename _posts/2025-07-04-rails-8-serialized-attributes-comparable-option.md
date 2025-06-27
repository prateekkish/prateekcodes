---
layout: post
title:  "Rails 8 adds comparable option to serialized attributes"
author: prateek
categories: [ Rails, Rails 8, ActiveRecord ]
tags: [ rails-8, activerecord, serialization, performance-optimization, database ]
excerpt: "Rails 8 introduces a `comparable` option for serialized attributes, preventing unnecessary database writes when serialized data representations change but the content remains the same."
description: "Learn how Rails 8's new comparable option for serialized attributes prevents phantom updates and improves performance by intelligently comparing serialized data."
keywords: "Rails 8 serialized attributes, comparable option Rails, ActiveRecord serialization, prevent unnecessary database writes, Rails performance optimization"
---

Serialized attributes in Rails have always had a subtle problem: changes in how data is serialized can trigger database updates even when the actual data hasn't changed. Rails 8 introduces the `comparable` option to solve this issue.

## The Problem

When using serialized attributes, the same data can have different string representations:

```ruby
class User < ApplicationRecord
  serialize :preferences, coder: JSON
end

user = User.create!(preferences: { theme: "dark", notifications: true })

# Later, the preferences hash might be reordered
user.preferences # => {"notifications" => true, "theme" => "dark"}

# Even though the data is the same, Rails thinks it changed
user.changed? # => true
user.save! # Unnecessary database write!
```

This problem becomes worse when:
- JSON libraries change their serialization behavior
- Hash keys get reordered (Ruby doesn't guarantee hash ordering across versions)
- Float precision changes slightly
- Whitespace or formatting differs

## Rails 8 Solution

Rails 8 adds a `comparable` option that compares the deserialized objects instead of their serialized strings:

```ruby
class User < ApplicationRecord
  serialize :preferences, coder: JSON, comparable: true
end

user = User.create!(preferences: { theme: "dark", notifications: true })

# Even if the serialized form changes
user.preferences = { "notifications" => true, "theme" => "dark" }

# Rails now knows the data is the same
user.changed? # => false
user.save! # No database write!
```


## Custom Serializers

The comparable option works with custom serializers too:

```ruby
class CompressedJSON
  def self.dump(obj)
    Zlib::Deflate.deflate(obj.to_json)
  end
  
  def self.load(data)
    return {} if data.nil?
    JSON.parse(Zlib::Inflate.inflate(data))
  end
end

class Archive < ApplicationRecord
  serialize :data, coder: CompressedJSON, comparable: true
end
```


## When to Use comparable: true

Use it when:
- Data comes from external APIs that might reorder fields
- Using JSON/YAML serialization where formatting can vary
- Storing configuration or settings that rarely change
- Working with legacy data that might have inconsistent serialization

Don't use it when:
- The serialized data includes timestamps or unique identifiers that should trigger updates
- You need to track any change in serialization format
- Using custom serializers with complex comparison logic


## Conclusion

The `comparable` option is a small but impactful addition that prevents phantom updates in Rails applications. It's especially valuable for applications that sync data with external sources or deal with serialized configurations.

## References

- [Pull Request #53946](https://github.com/rails/rails/pull/53946){:target="_blank" rel="nofollow noopener noreferrer"} introducing comparable option
- [ActiveRecord Serialization Documentation](https://api.rubyonrails.org/classes/ActiveRecord/AttributeMethods/Serialization/ClassMethods.html){:target="_blank" rel="nofollow noopener noreferrer"}
- [Rails 8 Release Notes](https://guides.rubyonrails.org/8_0_release_notes.html){:target="_blank" rel="nofollow noopener noreferrer"}