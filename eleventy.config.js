const syntaxHighlight = require("@11ty/eleventy-plugin-syntaxhighlight");
const markdownItAnchor = require("markdown-it-anchor");

module.exports = function(eleventyConfig) {
  eleventyConfig.addPassthroughCopy("src/assets");
  eleventyConfig.addPassthroughCopy("src/posts/**/images/**");
  eleventyConfig.addCollection("posts", (api) =>
    api.getFilteredByGlob("src/posts/**/*.md").sort((a, b) => b.date - a.date)
  );
  eleventyConfig.addPlugin(syntaxHighlight);
  
  // Add custom filter to extract TOC from content
  eleventyConfig.addFilter("tocExtract", (content) => {
    if (!content) return "";
    
    const headings = [];
    // Match h2 and h3 tags with IDs - text is inside <span> within the anchor link
    // Use a single regex to capture both levels and preserve document order
    const headingRegex = /<(h[23])[^>]*id="([^"]+)"[^>]*><a[^>]*class="header-anchor"[^>]*><span>(.*?)<\/span><\/a><\/\1>/g;
    
    let match;
    
    // Extract all headings in document order
    while ((match = headingRegex.exec(content)) !== null) {
      headings.push({
        level: match[1] === 'h2' ? 2 : 3,
        id: match[2],
        text: match[3].trim().replace(/<[^>]*>/g, '') // Strip any remaining HTML tags
      });
    }
    
    // Generate TOC HTML
    if (headings.length === 0) return "";
    
    let html = '<ul class="toc-list">';
    for (const heading of headings) {
      html += `<li class="toc-item toc-level-${heading.level}">`;
      html += `<a href="#${heading.id}">${heading.text}</a>`;
      html += '</li>';
    }
    html += '</ul>';
    
    return html;
  });
  
  // Configure markdown-it with anchor plugin for TOC
  eleventyConfig.amendLibrary("md", (mdLib) => {
    mdLib.use(markdownItAnchor, {
      permalink: markdownItAnchor.permalink.headerLink({
        safariReaderFix: true,
      }),
      level: [2, 3], // Only h2 and h3
      slugify: eleventyConfig.getFilter("slugify")
    });
  });
  return {
    dir: { 
      input: "src", 
      includes: "_includes", 
      data: "_data", 
      output: "_site" 
    },
    templateFormats: ["njk", "md"],
    markdownTemplateEngine: "njk",
    htmlTemplateEngine: "njk"
  };
};
