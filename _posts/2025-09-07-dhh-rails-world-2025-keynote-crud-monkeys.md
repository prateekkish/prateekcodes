---
layout: post
title: "DHH's Rails World 2025 Keynote: We're All CRUD Monkeys, and That's OK"
author: prateek
categories: [ Rails, Rails 8, Conference ]
tags: [ rails, dhh, keynote, rails-world, complexity, linux, omachi ]
excerpt: "DHH admits we're all CRUD monkeys, kills system tests, shows off his Linux distro, and reminds us that deployment used to take 5 seconds with FTP."
description: "Complete summary of DHH's Rails World 2025 keynote covering Rails 8.1 features, the philosophy against complexity, and the introduction of Omachi Linux distribution for Rails developers"
keywords: "dhh, rails world 2025, rails 8.1, omachi linux, action push, lexie editor, rails complexity, crud development, edge computing"
date: 2025-09-07
---

DHH started his Rails World 2025 keynote with a rant, and honestly, it hit home. Back in 1999, he could deploy a web app change in five seconds using FTP. Five seconds! Today? Teams of 50 developers are waiting 30 minutes, an hour, sometimes three hours for their CI/CD pipelines to finish. Some folks at the conference mentioned eight-day deployment cycles.

We have faster computers than ever. More open source tools. Better everything, supposedly. Yet somehow we've made the simple act of shipping code exponentially slower. DHH's theory? We've stopped solving whole problems. Instead, we slice everything into tiny pieces, optimize each piece in isolation, and when we put it all back together, we've actually gone backwards.

## We're All CRUD Monkeys

"I'm a CRUD monkey," DHH said, and I could feel the room shift a bit. "My career is CRUD monkeying. It is reading things from a database, creating records, updating those records, and occasionally deleting them."

He's right, though. Strip away all the microservices, the event sourcing, the CQRS patterns, and what are we actually doing? Reading from databases. Writing to databases. Maybe formatting it nicely with some CSS. We've built entire careers making this basic pattern seem more complex than it needs to be.

DHH blames our psychology. We want to feel like we're doing computer science, not just shuffling data around. So we buy into what he calls "merchants of complexity" who sell us complicated solutions to simple problems. Rails, he argues, should stay a "mega framework" that just solves the whole damn problem instead of making you piece together 47 different libraries.

## What's Actually New in Rails 8.1

### Markdown Finally Gets First-Class Support

Markdown is everywhere now. AI loves it. Developers write in it. So Rails 8.1 finally makes it dead simple:

```ruby
# Simple Markdown rendering
render markdown: @post

# Duck-typed object conversion
format.md { render markdown: @post }
```

DHH added this feature himself via PR #55511, motivated by Markdown becoming "the formatting language of AI." He's been writing tons of Markdown lately for some Linux manual (more on that wild tangent later).

### Trix is Dead, Long Live Lexxy

Trix is getting replaced. DHH admitted what we all knew: hardly anyone outside 37signals wanted to help maintain Trix, so it languished. The replacement is actually called Lexxy (not Lexie), which the 37signals team built on top of Meta's Lexical editor (the one powering WhatsApp and Instagram).

The big wins? Live syntax highlighting for code blocks (finally!), and you can paste Markdown directly into it. Meta has a whole team maintaining Lexical for their billions of users, so Rails gets to piggyback on that work. 37signals just launched the Lexxy beta 4 days before the conference, and they're actively seeking community help on GitHub.

```ruby
# Same Rails API, different editor under the hood
class PostsController < ApplicationController
  def create
    @post = Post.new(post_params)
    # Lexie handles the rich text editing
  end
end
```

### Jobs That Don't Die During Deploys

37signals learned this one the hard way after leaving AWS. When you deploy with Kamal, containers get 30 seconds before they're killed. Got a job exporting a massive Basecamp account that takes three hours? Too bad, start over.

Donal McBreen from 37signals led the development of Action Job Continuations (PR #55127) to fix this:

```ruby
class ExportJob < ApplicationJob
  include ActionJob::Continuations
  
  def perform(account)
    continuation_point :gather_data
    data = gather_account_data(account)
    
    continuation_point :generate_export  
    export = generate_export_file(data)
    
    deliver_export(export)
  end
end
```

Now jobs can pick up where they left off after a deploy. Should have had this years ago.

### Push Notifications Without AWS

37signals is nuking their AWS account (DHH mentioned this casually, like it's no big deal), so they needed to replace AWS Pinpoint. Rosa Gutiérrez from 37signals has been working on the push notification infrastructure. Action Push Native talks directly to Apple and Google, and there's a similar gem planned for web push:

For the offline capabilities, Rosa has been extracting lessons from HEY's implementation to build proper offline support for Turbo using service workers ([PR #1427](https://github.com/hotwired/turbo/pull/1427){:target="_blank" rel="noopener noreferrer" aria-label="Turbo PR 1427 offline support (opens in new tab)"} on the Turbo repo). She gave another talk at Rails World about "Bringing Offline Mode to Hotwire with Service Workers".

```ruby
# config/push.yml
production:
  apple:
    key_id: <%= Rails.application.credentials.apple.key_id %>
    team_id: <%= Rails.application.credentials.apple.team_id %>
  
# Usage
device = ActionPush::Device.create(
  token: device_token,
  platform: :apple
)

ActionPush::Notification.deliver(
  device: device,
  title: "New Message",
  body: "You have a new message"
)
```

## What Rails is Killing Off

### System Tests Are Finally Dead

DHH stood on stage 10 years ago and declared system tests were the future. Yesterday, he admitted he was wrong. "System tests never worked. They're always brittle, always broken, always slow, and totally not worth it."

37signals nuked almost all system tests from Hey, keeping only 10 as smoke tests. Not a single bug slipped through that the deleted tests would have caught. Rails 8.1 stops generating them by default. Good riddance.

### Your Laptop is Faster Than the Cloud

Remember Puma-dev? That tool for getting nice local URLs? Dead. Just use localhost with explicit ports. `localhost:3010` works fine. Turns out localhost became a secure context in 2017 and nobody noticed.

The Docker situation got simpler too. Run Ruby natively with Mise (which makes switching Ruby versions painless), but keep Docker just for databases. You need MySQL 8.0 for one project and 8.4 for another? Docker handles that. Everything else runs native.

But the real shocker was the CI benchmarks. DHH showed Hey's test suite (30,000 assertions) running on different machines:
- Cloud CI: 15+ minutes
- M4 Mac: Under 4 minutes  
- AMD desktop: 1 minute 12 seconds

Your laptop with an M4 chip is literally faster than whatever you're renting from AWS. Rails 8.1 adds a DSL for running CI locally, with developers attesting their tests passed before merge. "Trust your developers," DHH said. "If they lie, fire them." Fair enough.

## DHH Made His Own Linux Distro Because Why Not

This is where things got weird. DHH has spent the last two months obsessed with creating his own Linux distribution called Omachi. He blamed Typecraft (who was apparently in the audience) for dragging him down the Linux rabbit hole with a YouTube video about tiling window managers.

The live demo was genuinely impressive. He booted a Framework laptop from a USB stick and had Rails running in under 5 minutes. The whole thing looks like a hacker movie from the 90s, complete with ASCII art boot screens and tiling windows that resize automatically.

Omachi comes with everything a Rails developer needs: Git, Mise, Docker, all the databases, even aliases like typing just 'r' instead of 'rails'. It uses something called Hyperland for window management, which means you barely touch the mouse. Everything is keyboard shortcuts and terminal interfaces.

They're giving away 200 USB sticks with Omachi at the Basecamp booth, but DHH warned he'll look you in the eye and ask if you're actually going to install it. "I'm not giving you a fucking souvenir," he said. The sticks cost him $7 each.

## The Fizzy Edge Computing Experiment

DHH showed a server running in his utility closet. Literally in his closet, next to some cleaning supplies. It's a $300 mini PC that runs Campfire for everyone at the conference. The same specs would cost $1,200/month on AWS.

This led to 37signals' new product Fizzy, where they're trying something crazy: instead of big data centers, have tons of tiny ones. Give every customer their own SQLite database and replicate it near them.

The math is interesting. Light takes 220 milliseconds to travel from New York to Sydney and back. Just the speed of light, nothing else. Do a POST request with redirects? You're looking at 700ms before your code even runs. But Copenhagen to Copenhagen? 2 milliseconds.

To make this work, multiple 37signals developers built specialized tools:
- **Active Record Tenanting**: Mike is developing this to give one database per customer (not per app, per CUSTOMER)
- **Beamer**: Kevin McConnell built this SQLite replication system that handles thousands of databases in real-time. He gave another talk about it at Rails World.
- **Kamal Geo Proxy**: Routes you to the nearest server (extension of Kevin's work on Kamal Proxy)

The target is 200ms response times, which DHH notes is about the reaction time of an F1 driver when the lights go out. If Fizzy works, most users would be within 25ms of their data.

## The Roman Empire Thing

DHH went full philosophy professor at the end, comparing Rails to the Roman Empire at its height. He threw out three Latin words that supposedly drive everything:

- **Libertas** (Freedom): You can change anything in Rails because it's just Ruby. Hell, you can monkey-patch String if you want. "We're not afraid of our citizens," he said.
- **Proprietarius** (Ownership): Nobody tells you how to build your app. Not even DHH, though he will tell you RSpec syntax is ugly.
- **Pietas** (Duty): You're not just a consumer. You're supposed to contribute back. Do your part for the empire.

## The Bottom Line

Rails 8.1 ships today. Rafael França, the release manager, was literally going to push the button after the keynote. This release represents the work of over 500 contributors across 2,500 commits in the last ten months.

The features are nice: resumable jobs (thanks to Donal McBreen), better editor (from the 37signals team), Markdown support (DHH's PR), push notifications (Rosa Gutiérrez's work). But the philosophy shift matters more. The Rails team wants us to stop accepting that deployment takes 30 minutes. Stop accepting that we need 47 services to run a web app. Stop accepting that our MacBooks are too slow to run tests.

Joe Masilotti, who's been instrumental in building Hotwire Native with 37signals since 2016, is closing out day one with a keynote about Hotwire Native 1.3. His TurboNavigator library became the foundation for the new built-in navigation, and he literally wrote the book on "Hotwire Native for Rails Developers."

The Omachi thing might seem unhinged (making your own OS to avoid asking Apple for permission is certainly a choice), but it proves a point. If you own your entire stack, from the operating system to the framework, you can make it work exactly how you want. No merchants of complexity. No permission needed.

Five seconds to deploy with FTP in 1999. That's the bar. We should be embarrassed it takes longer now with all our modern tools. Maybe the Rails philosophy is right. Maybe we really are just CRUD monkeys who've been tricked into thinking we need Kubernetes. At least now we have a whole team of talented developers at 37signals and in the Rails community working to make that CRUD simpler and faster.