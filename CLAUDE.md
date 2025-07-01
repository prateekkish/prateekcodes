# Prateek's Writing Style Guide

## Blog Post Characteristics

### Title Patterns
- Clear, descriptive titles that state exactly what the feature does
- Format: "Rails X adds/introduces [feature] to/for [purpose]"
- Avoids clickbait or overly dramatic language
- Includes version numbers when relevant (Rails 7, Rails 8, etc.)

### Structure Preferences
- Direct problem statement upfront - no lengthy introductions
- "Before" and "After/Rails X" sections to show clear improvements
- Code-heavy examples that demonstrate real usage
- Minimal fluff - gets straight to the point
- Avoids corporate speak or marketing language

### Code Examples
- Practical, realistic examples that developers would actually encounter
- Shows both the problem and solution with actual code
- Includes comments in code to explain what's happening
- Uses common Rails patterns (User, Product, Order models)
- Shows SQL output when relevant to understanding

### Sections to Avoid
- Lengthy "Real-world Example" sections (prefers integrated examples)
- "Performance Considerations" unless backed by actual benchmarks
- "Migration Strategy" sections that state the obvious
- Complex nested examples when simple ones suffice
- Overly detailed implementation guides

### Writing Tone
- Technical but approachable
- Assumes reader has Rails knowledge
- Concise conclusions (2-3 sentences max)
- No emoji usage
- Professional but not stiff

### Technical Accuracy
- Always verify PR references and technical claims
- Include correct links to GitHub PRs and documentation
- Use proper technical terminology (e.g., "Parameters#expect" not "params.expect()")
- Cite sources when making claims about Rails behavior

### Formatting Preferences
- Uses backticks for inline code references
- Clear section headers with ##
- Bullet points for lists
- Bold for emphasis on key points
- External links open in new tabs with security attributes (`target="_blank" rel="noopener noreferrer"`)

### SEO Optimization
- Includes comprehensive front matter with keywords
- Uses tags for categorization and discovery
- Writes descriptive excerpts that include main keywords
- Creates keyword-rich descriptions that accurately summarize content
- Targets specific search terms Rails developers would use

### Visual Content
- Identifies opportunities where diagrams would help explain concepts
- Calls out when architecture diagrams would be beneficial
- Suggests images for complex workflows or system designs
- Notes where benchmark/performance graphs would add value
- Mentions when database schema diagrams would clarify relationships

### Content Focus
- Solves real developer problems
- Shows practical benefits
- Avoids theoretical discussions
- Focuses on what changed and why it matters
- No unnecessary background or history lessons

### Blog Series Approach
- Comprehensive multi-part series for complex topics
- Each part builds on previous knowledge
- Clear "What's Next?" sections linking parts
- Consistent structure across series posts

## Specific Preferences

### Things to Include
- Deprecation warnings when relevant
- Error messages developers will actually see
- Common pitfalls and how to avoid them
- Links to official documentation
- Brief "When to use" guidance

### Things to Exclude
- Marketing speak ("game-changer", "revolutionary")
- Excessive explanation of basic Rails concepts
- Personal anecdotes or opinions
- Speculation about future features
- Overly complex architectural discussions

## Example Blog Post Flow
1. Brief introduction stating the problem (1-2 sentences)
2. "Before" section showing current approach
3. "Rails X" or solution section
4. Simple, practical code examples
5. When to use this feature (bullet points)
6. Brief conclusion (2-3 sentences)
7. References with correct PR links

## Image Opportunities to Call Out
- Database architecture changes (e.g., "An architecture diagram showing primary-replica setup would help here")
- Complex workflows (e.g., "A sequence diagram of the request flow would clarify this")
- Performance comparisons (e.g., "A benchmark graph showing before/after would be valuable")
- System interactions (e.g., "A diagram showing how services communicate would help")
- State machines or process flows
- Connection pooling visualizations
- Query execution paths

## Jekyll Blog Post Setup

### File Location and Naming
- Blog posts go in the `_posts` directory
- Filename format: `YYYY-MM-DD-title-with-hyphens.md`
- Example: `2024-12-27-rails-8-framework-defaults.md`

### Required Front Matter
```yaml
---
layout: post
title: "Your Blog Post Title"
author: prateek
categories: [ Rails, Rails 8, Topic ]
tags: [ rails, feature, relevant-tags ]
excerpt: "Brief summary for post listings"
description: "SEO-optimized description"
keywords: "comma, separated, keywords"
---
```

### External Links Format
All external links must include security attributes:
```markdown
[Link Text](https://example.com){:target="_blank" rel="noopener noreferrer"}
```

## Key Principles
- **Clarity over cleverness**
- **Practical over theoretical**
- **Concise over comprehensive**
- **Accurate over assumptive**
- **Direct over diplomatic**