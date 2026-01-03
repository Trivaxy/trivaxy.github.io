---
layout: layouts/base.njk
title: Compilers - From Play to Production
---

I'm a nerd when it comes to creating compilers and interpreters.

Out of the handful of pet projects I've done over the years, the ones which went the farthest and grew to be the biggest in terms of code size have undoubtedly been all sorts of language implementations.

Frankly, I don't really *remember* how I learned to implement languages. But it involved a lot of trial and error combined with a stubborn refusal to read books because of my impatience. Eventually I got *something* that actually worked and ran.

My first programming language was called [Leibniz](https://github.com/trivaxy/leibniz-lang), written when in Rust when I was still quite new to it.

It was an interpreted language that compiled to an internal representation/bytecode that gets executed. Looking back, the language was *funky*, but in admittedly fun ways. All loops were implicit summations, complex numbers were built-in, conditionals were all ternaries, and arrays and data structures were always immutable.

The language didn't have any kind of GC or reference counting. Mainly because I didn't think about it for whatever reason.

When I first started working on Leibniz, my biggest hurdle was the parser. I had never written a parser before at the time, and I didn't understand *how* you could write a piece of code that takes source code as input and then... understands the syntax?

That's when I first started reading about parsers and the concept of an AST (Abstract Syntax Tree). It's *also* when I discovered parser generators, eventually landing on [pest](https://pest.rs/)

## Parser generators are seductive, but disapponting

It's nice to *not* worry about the frontend of your implementation (lexing and parsing). Parser generators market themselves as exactly the way to do that: instead of writing the code to do it yourself, you instead *specify* the grammar of your language in some kind of structured notation, and pass it to the parser generator.

The generator then produces the actual parser code for your grammar, which you call and use. In concept, this is actually clean and nice: instead of writing a parser that could be hundreds (or even thousands) of lines long, you just specify a very tiny grammar file by comparison which does the same job.

Having a grammar file is also good, because it contains... well, a grammar. You officially have the concrete syntax rules of your language consolidated in one place, which you can use as documentation for the *especially* nerdy people who might ask about it. It also serves as formal documentation for other developers who might want to work on the language's implementation directly.

However, having a specific grammar is practically irrelevant for the end users of the language. When you first begin learning any language, *no one* throws this at you:
```
statement   = "var" , identifier , "=" , value , ";" ;

identifier  = letter , { letter | digit | "_" } ;

value       = number | string ;
number      = digit , { digit } ;
string      = '"' , { character } , '"' ;
letter      = "A"…"Z" | "a"…"z" ;
digit       = "0"…"9" ;
character   = ? any character except " and newline ? ;
```

Instead, they just say 'hey, so this is how we define a variable':
```js
var value = 10;
```

Perhaps with some added notes about what's a valid name for the variable. But that's it. A concrete example that delivers the point. No formal notation needed.

When you choose to use a parser generator, you effectively start writing your compiler in two languages: one for most of the compiler, and one for the tiny grammar. Most developers would rather not have any kind of split.

They also often complicate the build process or slow it down, since the parser's code needs to be generated first.

However, all of these are trivially solvable and aren't dealbreakers on their own.

The dealbreakers come from the resulting parser itself.

## Tooling-readiness

When I implemented the parser for Leibniz using pest, I could prototype pretty quickly. New syntax always meant a tiny modification to the grammar file, which meant I was almost always working on the actual runtime stuff for the interpreter rather than worrying about the frontend aspect.

Of course, as I would later learn, this comfort was not free.

The thing about parser generators is they all, historically, suffered from one or more of the following drawbacks:
1. They do not keep track of what source text each AST node refers to
2. They aren't as performant as hand-written parsers
3. They suck at producing error messages
4. They suck at recovering from errors, at best only doing it naively
5. They're slow

And these are *big* costs.

We live in an era where you expect your editor/terminal/whatever to instantly show you errors and warnings at *specific locations* within seconds of a keystroke, allow you to refactor code easily, and provide a semantic understanding of your code (otherwise things like 'go to definition' wouldn't work).

Not to say that all parser generators are the same. Some are better in certain areas than others. I've also noticed that a lot of the more modern generators try to address my above points seriously, and they succeed to *some* extent.

The reason why these points are important is because without them, your language is just not **tooling-ready**.

It's a bit of a vague term, but generally, I call a language "tooling-ready" if the compiler or interpreter it ships with can be used to essentially power editor plugins (via LSP for example), without needing to write *entire* new specific parsers from scratch that live in the plugin.

At that point, you're just wasting effort. You have a (maybe worse) parser in your compiler, and a separate parser in your extension/plugin.

Instead, the frontend of your compiler/interpreter should be capable of providing those capabilities. Take Clang for example: it's a compiler, but `clangd` wraps its frontend to become a language server. `rust-analyzer` is increasingly adopting `rustc` internals. `zls` uses Zig's own compiler frontend. That's the modern trend here.

So, how do you write a good frontend for your language's implementation?

Step one is to not use a parser generator.

## Handwritten parsers get the *right* job done

I'm not saying parser generators are useless, they're great for rapid prototyping, but I have yet to see a generator used in any production-grade language server.

And it's not just a matter of choice: like I said earlier, a lot of parser generators just fall short in a lot of critical areas. If it can't even tie AST nodes to source text, how would you even implement something as simple as 'go to definition'? If it can't recover from errors, how do you expect to ever report more than one error at a time? Nowadays, you expect *every* error to be thrown at you in one go, rather than you needing to fix them one by one just to see the rest.

When you write a parser from scratch, you get to control everything. That's obvious, but it unlocks a few key things for you:
1. You control how much (and what) information your AST captures
2. You can provide good error messages since it's much easier to track the source
3. You can perform *intelligent* error-recovery, rather than only using the 'skip tokens' approach
4. You can pick whatever type of parser to write or even mix them (e.g. pratt parsing for expressions, recursive descent for everything above that)
5. You get to optimize as you wish, and it'll probably be faster than a generated parser from the get-go

It's not enough to simply parse input and bail on fail, which is unfortunately what generated parsers *only* excel at. Modern parsers need to be more sophisticated because developer needs are more sophisticated, and thus the good ones are handwritten.

## Getting There

Most tutorials that teach you how to build a language (such as Crafting Interpreters) tend to focus only on building a functional parser. That's fine for learning, but a lot of them seem to omit that they are anything but robust.

That's why I always tell people who aspire to build compilers and interpreters the same thing: do something basic and simple, then *immediately* focus on upping your frontend game. It is genuinely the difference between your language being practically usable vs. not.

I'll be honest: I never actually looked up or researched much about implementing robust parsers. Instead, I chose to dive off the deep end when I implemented [Sculk](https://github.com/Trivaxy/sculk), and learned a lot that way.

The *very* first requirement is that your tokens need to keep track of their position in the original text.

Your token data type should **not** look like this:
```rust
enum Token {
    Identifier(String),
    Plus,
    Minus,
    Number(i64),
    // ...
}
```

It should look something like this:
```rust
struct Token {
    start: usize,
    end: usize,
    ty: TokenType,
}

enum TokenType {
    Identifier,
    Plus,
    Minus,
    Number,
    // ...
}
```

Tokens should obviously have a type, but also their *span* in the original text. Without this kind of info, your parser will not be able to track any kind of positioning in nodes or in errors. Don't treat them as containers for your data, they should only be windows into the input source. Your lexer should be responsible for directly setting each token's `start` and `end`.

Similarly, your AST nodes should not look like this:
```rust
enum AstNode {
    BinaryOp(OpType, Box<AstNode>, Box<AstNode>),
    NumberLiteral(i64),
    Identifier(String),
    // ...
}
```

Instead, they should look similar to what we did for tokens:
```rust
struct AstNode {
    start: usize,
    end: usize,
    ty: AstNodeType,
}

enum AstNodeType {
    BinaryOp(OpType, Box<AstNode>, Box<AstNode>),
    NumberLiteral(i64),
    Identifier(String),
    // ...
}
```

(Actually, even the above still has problems which we'll get to - but it's better than the original approach)

Since every AST node is formed by consuming tokens, an AST's `start` is simply the `start` of the first token consumed, and its `end` is the `end` of the last token consumed. This info is pretty easily derived, so you don't need to write logic for it in every nook and cranny of your parser.

As an example, Sculk has this function in its parser which automatically handles setting `start` and `end` for nodes without needing to know what exactly was parsed:
```rust
fn call(
    &mut self,
    parser: impl for<'b> FnOnce(&'b mut Parser<'a>) -> ParserKindResult,
) -> ParseResult {
    self.current_node_starts // current_node_starts is a Vec<usize>
        .push(self.tokens.peeked_span().start);

    // run the provided parser
    let result = parser(self);

    // easily figure out the resulting node's span
    let node_span = self.current_node_starts.pop().unwrap()..self.tokens.current_span().end;

    match result {
        Ok(kind) => Ok(ParserNode::new(kind, node_span)),
        Err(_) => Err(()),
    }
}
```

This small function is used everywhere inside Sculk's parser. It essentially:
- Records the start of the upcoming token
- Calls the parsing function
- Checks the end of the current token
- Constructs a span, which shows exactly where the node resides in text

```rust
fn parse_block(&mut self) -> ParserKindResult {
    expect_tok!(self, Token::LeftBrace, "expected {");

    let mut statements = Vec::new();

    while self.tokens.peek() != Some(&Token::RightBrace) {
        // use self.call, rather than self.parse_statement directly
        statements.push(self.call(Self::parse_statement)?);
    }

    expect_tok!(self, Token::RightBrace, "expected }");

    Ok(ParserNodeKind::Block(statements))
}
```

## Is it enough?

Well, now our nodes know exactly which sections of the input they came from. At this point, we've achieved at the very least decent error reporting and warnings. Rather than toss out "we expected a comma at line X and column Y" and stopping there, you can construct much more informative error messages highlighting where exactly problems occur and why.

It's also useful for reporting things like validation errors (e.g. type mismatches).

If you're writing an interpreter or compiler, I recommend checking out the `ariadne` crate. It lets you output pretty errors, and all you need to know is the spans of text you're trying to highlight.

That said, we're still not tooling-ready. Right now, our parser keeps track of positional information, but we haven't talked about error recovery at all.

As it turns out, error recovery for parsers is a bit of an art in its own right. Formally, when we say error recovery, we mean that when the parser encounters input that isn't valid syntax (i.e. not allowed by your language's grammar), it can still try to continue parsing *anyway*.

There's a lot of different strategies for recovering from errors. Talking about each one would take far too long for this post (and frankly, I don't have experience with all of them), so I'll highlight the main two strategies I recommend to people taking the leap from "fragile parser" to "awesome error-tolerant parser":
1. Token Synchronization
2. Phrase-Level Recovery

Those are arguably the two simplest ones, but they're surprisingly effective for most grammars.

## Token Synchronization

In Token Synchronization (also known as "Panic Mode"), when the parser runs into unexpected input, it'll stop parsing and instead *skip* all incoming tokens until it reaches a *synchronizing token*, then it continues parsing from there.

It's pretty simple - the idea here is essentially "keep skipping until you reach a token that looks like you can continue parsing from".

It's the strategy I employed in Sculk, and for a lot of grammars, it's decent. The challenge here is figuring out which tokens are *good* synchronizing tokens. Let's imagine we have some simple Rust-like language where you can only define variables and write basic expressions:
```rust
let x = 10;
let z = x * 2 - 12;
```

In our not-Rust language, every declaration has to start with `let`, followed by an identifier, then `=`, and then an expression, and finally a `;`. Expressions should have an obvious grammar so I won't detail them.

Now, let's introduce a simple syntax error:
```rust
let x 10; // missing =
let z = x * 2 - 12;
```

To a human reader, this error is so minor it may as well be ignored. To a fragile parser, it's the end of its world.

But with token synchronization, it doesn't have to be. We assign `let` to be a synchronization token. Now, when the parser expects `=` and doesn't see it, it enters panic mode and keeps skipping all tokens until it reaches `let`.

```rust
let x   10;
      ^ skipping starts here

let z = x * 2 - 12;
^ parser resumes here
```

And that's it. The parser gives up on the first statement, synchronizes on the next `let`, then resumes parsing from there.

You could also set `;` to be a synchronization token, depending on whether your parser assumes the next token or current token is where the resumed parsing should start.

In practice, token synchronization is decent enough that you can report a lot of errors, *provided* you pick good synchronization tokens. If you don't, you end up with *bogus* errors that the user doesn't care about. Imagine that identifiers themselves are synchronization tokens:
```rust
let x   10;
      ^ skipping starts here

let z = x * 2 - 12;
    ^ parser resumes here
```

Now, instead of having just `expected =` as an error, we *also* have `expected let` because the parser tries to parse a new declaration on a bad starting token.

Of course, the synchronization tokens you pick depend entirely on the grammar of your language. Identifiers are poor synchronization tokens here, but they might be great in yours. Though I'd bet they're also probably not. You can pick whatever tokens you want for synchronization, and sometimes they'll require trial and error. They're one of those things that you need to finetune.

It's worth mentioning, however, that the original `let x 10;` node is still *useful* information. Synchronization, as an approach, is all about discarding erroneous input. A smart parser would've been able to reasonably gleam that `let x 10;` *probably* means `let x = 10;`, report the error, but still return a `DeclarationNode` rather than just bailing, which in turn enriches all the later passes of your compiler/interpreter. A missing node helps no one.

## Phrase-Level Recovery

This one's objectively a *lot* better, but needs a bit more work. The idea remains simple, though.

With phrase-level recovery, your parser *guesses* what the input was supposed to look like. It does so by injecting tokens and skipping tokens in an attempt to fix the input.

Let's take this example:
```rust
let x 10
```

Token synchronization would not even return this as a node. The moment the parser doesn't receive the `=`, the entire declaration is skipped.

With phrase level recovery, the parser would *inject* the missing tokens:
```rust
let x  = 10;
inject ^   ^
```

The parser could also *skip* tokens, like in synchronization, and *replace* tokens, in an attempt to recover:
```rust
let a = (10 + 9));
           skip ^

let b = (10 + 9];
replace with ) ^  
```

The examples are simple, but you get the point. Phrase-level recovery just means "do your best to fix the input". Now, erroneous nodes still have a chance at being part of your AST, which means they get all the benefit of being visited by later passes.

Implementing phrase-level recovery depends on even more fine-tuning than token synchronization, and if you're not careful, your whole parser is going to end up riddled with just as much recovery logic as actual parsing logic.

So, let's keep it simple, and I'll show you an approach that achieves this recovery while also separating concerns.

I'm going to assume just a few things:
- Our `Token` type has a `start`/`end` and a `ty` enum to identify it
- We have a `TokenStream` type that has two methods:
  - `current()`, which returns the current token in the stream
  - `peek()`, which looks at the next token in the stream without moving to it
  - `next()`, which moves to the next token in the stream and returns it
- We have the `AstNode` and `AstNodeKind` types I showed earlier

