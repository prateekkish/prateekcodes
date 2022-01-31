---
layout: post
title:  "Rails adds a limit of fetching 10 records when using pretty print"
author: prateek
categories: [ Rails, Rails 7, Gotchas ]
---

[ActiveRecord::Relation#pretty_print](https://api.rubyonrails.org/classes/ActiveRecord/Relation.html#method-i-pretty_print)
is a method that pretty prints an `ActiveRecord::Relation` object.

### Example

Without pretty print:

```ruby
irb(main):002:0> Post.limit(2)
Post Load (2.7ms)  SELECT  "posts".* FROM "posts" ORDER BY "posts"."id" ASC LIMIT $1  [["LIMIT", 2]]
=> #<ActiveRecord::Relation [#<Post id: 1, title: "First Post", body: "First Post Body", created_at: "2022-01-18 07:30:36", updated_at: "2022-01-18 07:30:36">, #<Post id: 2, title: "Second Post", body: "Second Post Body", created_at: "2022-01-18 07:30:36", updated_at: "2022-01-18 07:30:36">]
```

With pretty print:

```ruby
irb(main):003:0> pp Post.limit(2)
Post Load (0.6ms)  SELECT  "posts".* FROM "posts" ORDER BY "posts"."id" ASC LIMIT $1  [["LIMIT", 2]]
[#<Post:0x00005654ccd32d28
  id: 1,
  title: "First Post",
  body: "First Post Body",
  created_at: Tue, 18 Jan 2022 07:30:36 UTC +00:00,
  updated_at: Tue, 18 Jan 2022 07:30:36 UTC +00:00>,
 #<Post:0x00005654ccd32b98
  id: 2,
  title: "Second Post",
  body: "Second Post Body",
  created_at: Tue, 18 Jan 2022 07:30:36 UTC +00:00,
  updated_at: Tue, 18 Jan 2022 07:30:36 UTC +00:00>]
=> #<ActiveRecord::Relation [#<Post id: 1, title: "First Post", body: "First Post Body", created_at: "2022-01-18 07:30:36", updated_at: "2022-01-18 07:30:36">, #<Post id: 2, title: "Second Post", body: "Second Post Body", created_at: "2022-01-18 07:30:36", updated_at: "2022-01-18 07:30:36">]
```

## Before

The method works great, but since it loads all the records of the relation, it can be very slow for bigger relations.

### Example

```ruby
irb(main):004:0> pp Post.all # Loads all the records
```

## Rails 7

Rails 7
[adds](https://github.com/rails/rails/pull/43302)
a limit of fetching upto 11 records when using pretty print much like
[ActiveRecord::Base#inspect](https://api.rubyonrails.org/classes/ActiveRecord/Relation.html#method-i-inspect)
if the records aren't already loaded.

**Note:** The 11<sup>th</sup> record is not shown. It is only loaded to determine whether there are more records to show.
An ellipsis (...) is shown instead of the 11<sup>th</sup> record.

### Example

```ruby
irb(main):005:0> pp Post.all
# Loads only 10 records and adds an ellipsis at the end if there are more records
Post Load (0.6ms)  SELECT  "posts".* FROM "posts" `/*` loading for pp `*/` ORDER BY "posts"."id" ASC LIMIT $1  [["LIMIT", 11]]
[#<Post:0x00007fed44c7abd0
  id: 1,
  title: "First Post",
  body: "First Post Body",
  created_at: Tue, 18 Jan 2022 07:30:36 UTC +00:00,
  updated_at: Tue, 18 Jan 2022 07:30:36 UTC +00:00>,
 #<Post:0x00007fed44c7aa68
  id: 2,
  title: "Second Post",
  body: "Second Post Body",
  created_at: Tue, 18 Jan 2022 07:30:36 UTC +00:00,
  updated_at: Tue, 18 Jan 2022 07:30:36 UTC +00:00>,
  #<Post:0x00007fed44c7a608
  id: 3,
  title: "Second Post",
  body: "Second Post Body",
  created_at: Tue, 18 Jan 2022 07:30:36 UTC +00:00,
  updated_at: Tue, 18 Jan 2022 07:30:36 UTC +00:00>,
  #<Post:0x00007fed44c7a478
  id: 4,
  title: "Fourth Post",
  body: "Fourth Post Body",
  created_at: Tue, 18 Jan 2022 07:30:36 UTC +00:00,
  updated_at: Tue, 18 Jan 2022 07:30:36 UTC +00:00>,
  #<Post:0x00007fed44c79ac8
  id: 5,
  title: "Fifth Post",
  body: "Fifth Post Body",
  created_at: Tue, 18 Jan 2022 07:30:36 UTC +00:00,
  updated_at: Tue, 18 Jan 2022 07:30:36 UTC +00:00>,
  #<Post:0x00007fed44c79398
  id: 6,
  title: "Sixth Post",
  body: "Sixth Post Body",
  created_at: Tue, 18 Jan 2022 07:30:36 UTC +00:00,
  updated_at: Tue, 18 Jan 2022 07:30:36 UTC +00:00>,
  #<Post:0x00007fed44c784c0
  id: 7,
  title: "Seventh Post",
  body: "Seventh Post Body",
  created_at: Tue, 18 Jan 2022 07:30:36 UTC +00:00,
  updated_at: Tue, 18 Jan 2022 07:30:36 UTC +00:00>,
  #<Post:0x00007fed44c73ec0
  id: 8,
  title: "Eighth Post",
  body: "Eighth Post Body",
  created_at: Tue, 18 Jan 2022 07:30:36 UTC +00:00,
  updated_at: Tue, 18 Jan 2022 07:30:36 UTC +00:00>,
  #<Post:0x00007fed44c73858
  id: 9,
  title: "Ninth Post",
  body: "Ninth Post Body",
  created_at: Tue, 18 Jan 2022 07:30:36 UTC +00:00,
  updated_at: Tue, 18 Jan 2022 07:30:36 UTC +00:00>,
  #<Post:0x00007fed44c73538
  id: 10,
  title: "Tenth Post",
  body: "Tenth Post Body",
  created_at: Tue, 18 Jan 2022 07:30:36 UTC +00:00,
  updated_at: Tue, 18 Jan 2022 07:30:36 UTC +00:00>,
  "..."]
```
