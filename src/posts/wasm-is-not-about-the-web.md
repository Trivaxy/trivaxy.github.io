---
layout: layouts/base.njk
title: WebAssembly is not about the Web
description: Taking a moment to look at the current state of WebAssembly, and considering if we should take "Web" out of the name
---

[WASI 0.3](https://bytecodealliance.org/articles/WASI-0.3) is now official, and the Bytecode Alliance has begun the journey towards the [1.0 version of the Component Model](https://bytecodealliance.org/articles/the-road-to-component-model-1-0)! Wow!

...What does that mean? What is *actually going on* with WebAssembly?

## Prologue

Before diving in, it's worth having a recap of what WebAssembly is and how it came to be.

For years, if you wanted to execute any kind of logic on the browser, JavaScript was the only tool you had available. Yes, you could choose to write in other languages (TypeScript, CoffeeScript, Haxe, etc) and then invoke a compiler that produces JavaScript that runs on the browser. A scripting language, used as a compilation target!

Whether this is a good thing or if it's blasphemy is up to you, though considering how HTML/CSS have also become compilation targets as well, it's poetic that JavaScript joined them.

Imagine you're creating a cool web application that can convert videos and audios to different formats, compress them, change bitrate, perform muxing etc. all on the clientside, without requiring a server. You search for a library to do this, and come across [WebCodecs](https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API)!

You quickly get to work, implement encoding and decoding for WebM and MP4, and then you slam headfirst into a wall. Once you recover from the concussion, you realize that WebCodecs serve a domain much narrower than you need. Outside of encoding and decoding common web formats, they didn't do much else. Your application needed to support a lot more formats, muxing, metadata editing, maybe even filter graphs.

If only there was something that could [do all this](https://github.com/ffmpeg/ffmpeg) out of the box...

Had this been 2014, you would've sighed, closed the project and `rm`'d the directory. You weren't willing to do this serverside, as the selling point was doing this on the user's browser.

Thankfully, it's *not* 2014. 12 years later, running ffmpeg wasn't just possible, it was explicitly supported by the project because of a neat thing that popped up dubbed **WebAssembly**.

## But what is WebAssembly?

WebAssembly is, simply put, an instruction format designed to run on a stack-based virtual machine. Not an actual *virtual* machine as in with a hypervisor and everything, but "virtual" as in "fictional machine that uses WebAssembly as its native machine language". 

Before we proceed further, let me solidify what that looks like. Suppose you have this C function, saved in a `square.c` file:
```c
int square(int num) {
    return num * num;
}
```

You can take that function and compile it *into* a WebAssembly module using `clang` (though doing this manually isn't preferable, which I'll get to in a moment).

```
clang --target=wasm32-unknown-unknown -O3 -nostdlib \
  -Wl,--no-entry \
  -Wl,--export=square \
  -Wl,-z,stack-size=0 \
  -o square.wasm square.c
```

Now you have a file called `square.wasm` - your module. WebAssembly is a binary format, so it's not a textual representation by default, but an optimized blob of bits and bytes that's quick to parse and understand.

However, WebAssembly *does* have a textual representation. We can pass our `square.wasm` file through a tool called [wasm2wat](https://github.com/WebAssembly/wabt) and end up with `square.wat`, which is the text equivalent that we can open up in an editor. Similarly, you can convert a `.wat` file to `.wasm` via the `wat2wasm` tool.

If we do that, we can take a peek at what's happening inside!
```wasm
(module $square.wasm
  (type $t0 (func (param i32) (result i32)))
  (func $square (export "square") (type $t0) (param $p0 i32) (result i32)
    local.get $p0
    local.get $p0
    i32.mul)
  (memory $memory (export "memory") 1)
  (global $__stack_pointer (mut i32) (i32.const 1024)))
```

Okay. Looks a little crowded, so let me strip away what we *don't* care about. Our function is right in the middle:
```wasm
(type $t0 (func (param i32) (result i32)))
(func $square (export "square") (type $t0) (param $p0 i32) (result i32)
    local.get $p0
    local.get $p0
    i32.mul)
```

The first line defines a type signature, named `$t0`. It specifies a function that receives and returns a 32-bit signed integer.

Our function definition is right underneath that. Several interesting things are happening in the function's header:
- `(func $square ...)` - this is the actual opening of our function, called `$square`
- `(export "square")` - this is really important. It exports our function to the host. More on this in a sec
- `(type $t0)` - this specifies the function signature by **linking** it to what was defined on the first line
- `(param $p0 i32) (result i32)` - these are actually redundant, as the function is already linked to `$t0`. `wasm2wat` just includes them for convenience so we don't always have to jump to the linked signature definition

Right beneath the function header though is the meat:
```wasm
local.get $p0
local.get $p0
i32.mul
```

This is where the "stack-based" part of WebAssembly lies. The `local.get` instruction fetches a local value, which could be a parameter or variable, and pushes its value on top of the stack. `i32.mul` pops two values off the stack, performs 32-bit signed integer multiplication, and pushes the result back on the stack.

In this case:
1. `local.get $p0` -> push `num` onto the stack
2. `local.get $p0` -> push `num` onto the stack again
3. `i32.mul` -> pop both values off the stack, push `num * num`

The function implicitly returns what's left on the stack.

## Actually doing something

Now that we have our `square.wasm` module, how can we get it to actually, you know, *do something*?

Simple. On your browser:
```js
async function init() {
  try {
    // Stream, compile, and instantiate the binary
    const { instance } = await WebAssembly.instantiateStreaming(fetch('square.wasm'));
    
    // Destructure the exported 'square' function from the module
    const { square } = instance.exports;
    
    // Execute the function
    const input = 12;
    const result = square(input);
    
    console.log(`${input} * ${input} = ${result}`);
  } catch (error) {
    console.error("Execution failed:", error);
  }
}

init();
```

Remember the `(export "square")` part of our function earlier? That's what allows it to be used by the host. Unexported functions remain strictly inside the WebAssembly module, uncallable from the outside world.

Right, but what if we want our module to be able to run `console.log`? Can the module *import* functions from the outside world?

Yes, yes it can. Let's modify our `.wat` file directly so that our `square` function prints the result as well as return it.
```wasm
(module $square.wasm
  ;; This is the important line!
  (import "host" "log_val" (func $log_i32 (param i32)))

  (type $t0 (func (param i32) (result i32)))
  
  (func $square (export "square") (type $t0) (param $p0 i32) (result i32)
    local.get $p0
    local.get $p0
    i32.mul
    
    ;; local.tee writes the top value on the stack to the destination
    ;; but, crucially, it doesn't pop the value - unlike local.set
    local.tee $p0 ;; save the result to $p0, WITHOUT popping the result
    call $log_i32 ;; the call here is going to pop the result off the stack

    ;; now we restore the saved result, so we can return it
    local.get $p0)

  (memory $memory (export "memory") 1)
  (global $__stack_pointer (mut i32) (i32.const 1024)))
```

We convert this back into a module with `wat2wasm`, and modify our JS slightly:
```js
async function init() {
  try {
    // Define the import object
    const importObject = {
      host: {
        log_val: (value) => {
          console.log(`From Wasm: ${value}`);
        }
      }
    };

    // Pass the importObject during instantiation
    const { instance } = await WebAssembly.instantiateStreaming(
      fetch('square.wasm'), 
      importObject
    );
    
    const { square } = instance.exports;
    square(12); // This will trigger the import and log "From Wasm: 144"
  } catch (error) {
    console.error("WebAssembly execution failed:", error);
  }
}

init();
```

So, what's actually going on here? Let's dissect this first:
```wasm
(import "host" "log_val" (func $log_i32 (param i32)))
```

That line defines a contract between our module and the host that's running it: the host must provide a function that receives an `i32` as a parameter and doesn't return anything. The `"host" "log_val"` part is the function's *two-level namespace*, which uniquely identifies it to both the host and the module.

Notice how our import object above matches that namespace? It's mandatory and validated by the browser:
```js
const importObject = {
    host: {
        log_val: (value) => {
            console.log(`From Wasm: ${value}`);
        }
    }
};
```

Well, that's pretty nifty! The outside world can use the module's functions, and the module's functions can use the outside world, *and* we get to strictly control what the module sees!

## Hideousness beneath the mask

So far, I'd only given a general feel for what WebAssembly *is*, fundamentally. It's just a code execution box that languages can target.

And that's exactly where most of the issues lie: WebAssembly is a *compilation target*, and was always designed to be that first and foremost. This means that it tries to make minimal assumptions about the languages that target it, which means that when a language does compile to WebAssembly (can I start abbreviating it as WASM? thanks), things can get *messy*.

Let's continue with C. This time, we want to compile this function to a WASM module:
```c
void reverse_string(char *s, int len)
{
    int i = 0;
    int j = len - 1;

    while (i < j) {
        char tmp = s[i];
        s[i] = s[j];
        s[j] = tmp;
        ++i;
        --j;
    }
}
```

The function looks innocent enough. However, we run into yet another wall, gaining our 2nd concussion: the `char*` type.

WASM is simple. The only primitive numeric types WASM has are `i32`, `i64`, `f32`, `f64`, and `v128`. How do you represent a *pointer* to a *bunch of characters* in WASM?

Well, WASM has this thing called linear memory. You've seen a glimpse of it earlier, in our `square` module, near the bottom:
```wasm
(memory $memory (export "memory") 1)
```

That line defines a region of linear memory, 1 *page* long, called `$memory`. In WASM, linear memory is just a big array of mutable bytes. That's it. A single page is exactly 64KiB in size, and you can only specify how big your memory is using pages as units.

Once you have your memory defined, your WebAssembly module is free to read and write from it as it wants, treating it as just a fat array of bytes it can index into.

Notice that `(export "memory")` as well - just like with functions, you can export module memory, making it accessible to the host as a byte buffer.

What we need at the moment is a way to send a string over to the WASM module and vice versa. Outside of WASM, strings are (usually) just a region of bytes, often null-terminated if you're C. We can easily use linear memory to do something identical:
1. Access the module's linear memory from the host
2. Set a region of bytes to something like "Hello\0", UTF-8 encoded
3. Get the index of the first character's position in linear memory (its pointer, basically)
4. Call `reverse_string` from the host side, passing that index and the length of the string

From then on, `reverse_string` handles swapping the characters in linear memory. The host then reads that region back as UTF-8, and voila.

Now, you might be thinking that this is sort of convoluted - but this is the price you pay when you want to make a portable execution format that makes minimal assumptions. The real issue is that as a developer, you might expect to write a ton of glue code just to serialize and deserialize values as they cross the boundary between the host and the WASM module.

Worse, some code likes to allocate! How does `malloc` work inside a WASM module? Or `printf`? Or `strlen`? And that's *just* C. What about multithreading? Opening files and writing to them? Spawning processes? *Literally anything useful?*

Dozens of different languages can target WASM, each with their own standard libraries and semantics, and they're used to write software that operates outside of WASM by default. There's a big, glaring chasm here between software in the real world and getting that software to run inside WASM.

What to do, then?

## Emscripten

Remember our current problem: given a C/C++ codebase, how can we compile it to run on the web with minimal changes to the source?

Earlier, I said that you typically don't want to use `clang` manually to produce `.wasm` blobs. The target, which is `wasm32-unknown-unknown`, makes minimal assumptions about the host environment. This means that it won't pull in libc or provide any functions that allow interaction with the external system, so no file APIs, no sockets, no clocks or randomness, no interaction with stdout/stdin, etc.

Your WASM module essentially just lives in a vacuum. This is fine for some use cases, perhaps if your module is mainly used for number crunching and doesn't need to interact with the host other than returning results, but most C/C++ software does need some kind of interaction with the system it runs on. When compiling to WASM, *something* needs to bridge that gap and make the module capable of talking to the host as if it were a 'regular' system.

Enter [Emscripten](https://emscripten.org/). The website defines it as this:
```
Emscripten is a complete compiler toolchain to WebAssembly, using LLVM, with a special focus on speed, size, and the Web platform.
```

'Toolchain' here is doing a lot of heavy lifting. What Emscripten mainly does is *emulate a C runtime environment*. Pretty much putting POSIX in the browser.

Let's take `printf` as an example. When you compile an application like this using Emscripten instead of `clang` directly:
```c
#include <stdio.h>

int main() {
    printf("hello\n");
}
```

... several things happen.

Emscripten invokes `clang` to compile your code to WASM, however, it explicitly instructs `clang` to treat symbols like `printf` as *imported functions* in the module, rather than seeking out an implementation and complaining when it doesn't find one.

It also generates a JavaScript file alongside your WASM module where all the magic happens. This JS file does a *ton* of the work:
1. It provides implementations of functions like `printf`. Remember our earlier example with `log_val`? Same concept here - Emscripten is providing the host implementation of `printf` that the module can call.
2. It provides a *C runtime environment*. Take a function like `fopen` for example. Emscripten provides an implementation for it by emulating a virtual filesystem in-memory. Most of the commonly used functions in C/C++ codebases have an implementation in Emscripten, so it's essentially providing a POSIX API to the WASM module. It also provides implementations for OpenGL and SDL functions by relying on the browser canvas, plus other things. You get the point. It emulates the world for WASM.
3. Emscripten also provides abstractions for calling WASM functions. It deals with serializing values, placing them in the module's linear memory, calling the function, and deserializing the returned values from memory for the JS side

This isn't an exhaustive list, Emscripten employs other techniques which are also important such as optimizing the generated WASM and emulating some C/C++ language features, but those are the 3 biggest ones.

The end result from your perspective is that you end up with a `.wasm` blob, containing the compiled application, and `.js` glue which the blob needs to work, and the glue *you* need to call into the functions in the blob.

With this, we can breathe a sigh of relief: ffmpeg can in fact [run on the browser](https://github.com/ffmpegwasm/ffmpeg.wasm).

## Escaping the browser

A question might've popped up in your mind by now. If you can take a C/C++ application, compile it to WASM, and run it on a completely different platform than it was intended for (such as the browser), just by implementing the imported functions the WASM module wants, couldn't you make the module run *anywhere*, as long as the host is providing those functions?

Yes, yes you can.

A WebAssembly runtime, which is the software that consumes your WASM module and *runs* it, can very much run outside the browser. In fact, there are *too many* WASM runtimes out there. Notable examples are [Wasmtime](https://wasmtime.dev/), [Wasmer](https://wasmer.io/), [WasmEdge](https://wasmedge.org/), [WAMR](https://bytecodealliance.github.io/wamr.dev/)...

Whatever! There's a ton. You can just check [this repo](https://github.com/appcypher/awesome-wasm-runtimes) if you don't believe me.

... A couple of things on there aren't runtimes, for some reason, but still relevant.

WebAssembly, as a compilation target, has useful features that make it compelling even when you're not in a browser context at all.

Imagine, for example, that you're developing the backend of an application that scales up and down based on user demand. Latency is important to you, and depending on load, you may need to spin up VMs or destroy them to cut costs.

You take a look at the offerings for your cloud provider, and notice that the price fluctuates between ARM machines and x86 machines as time passes. Sometimes, it's cheaper to deploy on x86. Other times, ARM is cheaper - but the problem is that if your workload is *architecture-specific*, meaning you need separate artifacts for x86 and ARM, you increase complexity all around for your build and deployment process, and you accept the risk of running into architecture-specific quirks.

Most teams as a result just make a decision early on to only deploy on x86 or ARM - usually the former - but WebAssembly offers an alternative: just compile to `.wasm`, pick a runtime like Wasmtime to install on the target machine, and run the application. Done. As long as the application can be turned into a `.wasm` module, it will run anywhere a WASM runtime can run.

This is essentially the same advantage runtimes like .NET or the JVM provide, but taken further, as WASM is meant to be a *universal* target. C, C++, Rust, Zig, Go - at the moment, they excel at compiling to WASM and can reap its benefits. Other languages are catching up.

Another big talking point behind using WASM is an alternative to Docker (and existing containerization) in general. You might have seen [this tweet](https://xcancel.com/solomonstre/status/1111004913222324225?lang=en) by the creator of Docker before, which I think is worth dissecting.

I'm not the creator of Docker, so take this with a grain of salt - but Docker and WASM solve problems which overlap but aren't the same. Docker is meant to containerize your app by isolating it on top of the linux kernel directly and giving it a reproducible environment, but the actual execution of your application doesn't change. An x86 binary will still be running on the CPU as an x86 binary, and it can do anything a Linux process can do (provided it has the permissions, of course). Its strongest selling point is killing the 'Well, it works on my machine' argument.

WASM is an interesting deviation: instead of spawning containers, the runtime itself becomes the container. If you can manage to take your entire application and its dependencies and compile them into WASM, and you make them target WASI (or just any API that lets them talk to the external world) with minimal to no changes in source code, I think you've got a contender. WASM runtimes often start up insanely fast and beat containers in that regard, and have a smaller footprint.

So I *get* the point Solomon is making. Some big usecases can be served by both containers and WASM, but containers have an advantage here because they don't restrict the way you build your applications. The workflow is the opposite: you take an existing application, *figure out* how to containerize it, done. With WASM, the 'containerization' phase starts from within your IDE, which may not be a good thing.

Aside from containers, WASM is also establishing a strong niche when it comes to creating plugin/extension support for applications. If you want to allow users to write and run custom code to add additional functionality to an app, as well as distribute that code for others to use, you have a tradeoff to make:
1. Use a scripting language, such as Lua
2. Embed a WASM runtime in your application, treating WASM modules as extensions

Both are valid, and most applications go with the first approach, but there's reasons why the second approach with WASM exists now.

When you choose option 1, you gain ease of embedding by trading away performance (unless you use LuaJIT), which may or may not be an issue depending on your application. Additionally, you force developers to use Lua or any of the few languages that compile to it which often feel like Lua anyways. Not all developers enjoy the language. Still, embedding Lua is easy and widespread. It's successful for a reason.

Option 2 is more interesting. If you load and run WASM modules as extensions, you often have a higher performance ceiling, since WASM was designed for near-native speed execution (again, may not be relevant to you, depending on the app), but it's also *language-agnostic*. Developers can choose any language they want, *and* use any libraries they want, as long as it can compile to a WASM module. It unlocks developer preference and access to ecosystems, of which Lua generally achieves neither (Lua has an ecosystem, but it's much smaller than Rust's or C's by comparison)

Another perspective is security, which is a main focus for WASM. To be clear, "secure" in this case means that code executing inside WASM is confined to a sandbox and cannot see or access anything from the outside world. You are the one that has to explicitly give it access to do anything. A compromised WASM module is far less likely to compromise the sandbox/host, hence why WASM is really appealing when you want to run untrusted code in general.

WebAssembly had broken out of the browser.

## WASI

From then on, the people using WASM outside the browser noticed that, in many cases, WASM modules were relying on the host providing a POSIX-like API for the module to use, but the issue is that different runtimes implemented different APIs for even basic things like reading a file. If you wanted to target runtime A, you'd need to compile your WASM module to target that runtime's API, and then that module wouldn't work on runtime B or C.

At some point, the Bytecode Alliance - the org which is the main influence behind the WASM ecosystem - introduced **WASI**, short for **WebAssembly System Interface**. This was a fixed API for WASM runtimes to standardize on, so a WASM module that targeted WASI would run on any runtime that implemented WASI.

Again, at the end of the day, this is all a matter of a WASM module listing imported functions and the host supplying them. WASI just standardizes that list, and in doing so, brings WASM a lot closer to a "universal runtime" applications can target.

## Leave No Language Behind

WASM was originally designed with systems languages in mind, such as C/C++/Rust, as that's where most of the "applications we want to run in the browser but can't just port to JS" scenarios lay. Additionally, their nature as systems languages that don't require a runtime made them good fits. They only needed to map their semantics at the lowest level to WASM, which it was designed to be receptive towards (e.g. linear memory really is just a heap in terms of functionality).

However, this begs the question: what about other languages, like Python, C#, or Java? Those aren't compiled ahead-of-time into native executables, instead relying on managed runtimes. They lack a clear correspondence with WASM's semantics, unlike a language such as C.

The good news is that this isn't a dealbreaker. The runtimes themselves *are* written in C/C++, which we can compile to WASM. That's the idea behind projects like [Pyodide](https://pyodide.org/en/stable/), which compiles the CPython runtime to WASM via Emscripten, which you can then feed Python code to be interpreted as normal.

Runtimes which rely on a JIT compiler, like the JVM or .NET, are trickier. JITs fundamentally rely on self-modifying code: they write machine instructions to memory, mark the region as executable, and use it. WASM strictly disallows any kind of self-modifying code by design for security reasons, meaning you cannot have JIT behavior inside the module.

This also isn't a dealbreaker. .NET for example strips out the JIT, and only interprets bytecode when compiled to WASM. It's much slower, but that's the standard path that frameworks such as Blazor use. That said, .NET's AOT scene is getting quite mature, and modern .NET uses a mix of emitting direct WASM instructions and interpreting where needed.

The JVM has several different approaches, such as with [GraalVM Web Images](https://www.graalvm.org/latest/reference-manual/web-image/), [TeaVM](https://teavm.org/) and [CheerpJ](https://cheerpj.com/).

Again, the number of languages which have paths to WASM exceeds what I've listed here - these are just examples off the top of my head.

That said, it is becoming a lot easier for languages with runtimes to target WASM, specifically because of the WasmGC proposal, which is officially part of the WebAssembly 3.0 spec. Most browsers support it.

What makes WasmGC important is *specifically* the aforementioned group of languages we just talked about that require runtimes, which are often responsible for allocating and deallocating objects automatically and tracking lifetimes.

The proposal, to make a long story short, makes it possible to do the following:
1. You can define custom data structures such as structs and arrays (growable!), and state that a struct is a subtype of another struct
2. You can then allocate instances of those types using instructions like `struct.new` and `array.new`. The key thing here is that those values are allocated and managed by *the WASM runtime*, they do not live inside the module directly. Those instructions return completely opaque handles (references) that can't be constructed any other way
3. The WASM runtime is responsible for managing the lifetime of those objects and freeing them when they're not needed
4. Plus a bunch of other instructions for operations like testing reference equality, testing the type of a reference, and casting a reference

The entire idea behind WasmGC is "stop compiling your language's runtime to WASM, just emit a WASM module containing only your logic and take advantage of the WASM runtime giving you a GC and primitives to achieve OOP". Seems to work for a lot of languages, though not for .NET which has interior pointers. That's a whole topic which I won't get into this post, but it's worth a search!

## The Component Model

This one is also a big change that's already in WASI Preview 2 and WASI Preview 3, with support from a handful of runtimes.

The idea behind the component model is this: suppose you have two modules, one compiled from Rust, and the other from C++. Traditionally, having these modules interact was difficult since the types at the function boundaries can have completely different layouts, and both modules have no idea that the other exists ahead of time.

The component model tries to alleviate this by designating extra work to the WASM runtime and the compilers producing those modules. It introduces **WIT**, short for *WebAssembly Interface Types*, as well as a *Canonical ABI*.

I don't want to delve into the technical details of it, I think it deserves a different post (preferably not as long as this one), but it essentially solidifies WASM modules as reusable bundles of logic.

It upgrades your humble `.wasm` file by making it contain a *component*, rather than just a WASM module. A component can hold several modules inside, as well as a contract written using WIT defining what the component provides as well as its dependencies. It's essentially the idea of exporting and importing functions done at a higher level.

The Canonical ABI states how values, such as records, strings, lists, etc. should be laid out in memory, regardless of what language was used to create a component. The compilers for those languages all use the Canonical ABI so that when transferring values from one component to another, the receiver can understand the sender.

It's essentially what would happen if you took the C ABI and extended it to work with much higher level types.

The idea behind the component model is that you can compose different components together, regardless of how they were produced and without caring about the language used, provided that all the dependencies are met. This is the runtime's responsibility - for example, if component A expects specific functions, and component B provides those functions, the runtime *links* them so that if component A calls those functions, they get sent straight to component B. The runtime handles transferring arguments and return values back and forth.

## Exceptions

WASM didn't have any mechanism for throwing and catching exceptions, and now it does. This part isn't really that interesting so I won't write about it, but it *is* part of WASM 3.0 and so I thought it was worth mentioning. Helps more languages target WASM without needing to emulate exceptions, which would hinder performance.

## WebAssembly Is Not About The Web

~~oh my god! he mentioned the title of the blog post!!!~~

We're at the end! I hope I shed some light on how WebAssembly is receiving the same treatment JS did all those years ago when Node.js came out and became standard, elevating a language used for making pages interesting into an industry choice for writing entire applications and server-side logic. WASM seems headed in the same direction, and the people behind it are pretty forward with that intention.

WASM's case is more interesting than NodeJS though, since it isn't exactly 'yet another language' and moreso 'yet another substrate'. A platform that promises near-native performance, security, and portability. Maybe even world peace, which I'd say the JVM achieved the opposite of!

I don't want to come across as someone willing to die for WASM - I think it's interesting, but it's still something you reach for when you actually *need* it. I'm not spending hours trying to make my app play nice with WASM unless I know there's a big ROI, but it's certainly useful when circumstances demand it. To me, my main usecases for WASM would be targeting browsers, or running untrusted code as plugins for an app. Still not sure about using WASM for deployments, but if the component model achieves what it's promising, *maybe* I can toy around with it.

All in all, I think the takeaway here is that whatever is developed for the browser will eventually escape the browser. [Even browsers have already escaped browsers.](https://www.electronjs.org/)