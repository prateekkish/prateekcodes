# Jekyll plugin for SEO enhancements
module Jekyll
  # Automatically generate meta descriptions from content if not provided
  Jekyll::Hooks.register :posts, :pre_render do |post|
    # Auto-generate description if not provided
    if post.data['description'].nil? && post.data['excerpt']
      # Convert Jekyll::Excerpt to string before processing
      excerpt_text = post.data['excerpt'].to_s.strip
      post.data['description'] = excerpt_text.gsub(/\s+/, ' ').strip[0..159]
    end
    
    # Don't add default images - only use if explicitly provided
    # This prevents broken image references
    
    # Auto-generate keywords from tags and categories if not provided
    if post.data['keywords'].nil?
      keywords = []
      keywords += post.data['tags'] if post.data['tags']
      keywords += post.data['categories'] if post.data['categories']
      keywords << 'Ruby on Rails' << 'PostgreSQL' << 'Ruby'
      post.data['keywords'] = keywords.uniq.join(', ')
    end
  end

  # Add reading time to posts
  class ReadingTimeGenerator < Generator
    def generate(site)
      site.posts.docs.each do |post|
        words = post.content.split.size
        reading_time = (words / 200.0).ceil
        post.data['reading_time'] = reading_time
      end
    end
  end
end