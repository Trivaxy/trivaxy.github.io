const syntaxHighlight = require("@11ty/eleventy-plugin-syntaxhighlight");

module.exports = function(eleventyConfig) {
  eleventyConfig.addPassthroughCopy("src/assets");
  eleventyConfig.addCollection("posts", (api) =>
    api.getFilteredByGlob("src/posts/**/*.md").sort((a, b) => b.date - a.date)
  );
  eleventyConfig.addPlugin(syntaxHighlight);
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