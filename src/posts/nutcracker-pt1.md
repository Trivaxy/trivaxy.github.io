---
layout: layouts/base.njk
title: Nutcracker, Part 1
---

Randomness is awesome. It's in everything, from simple dice rolls, games, gambling, investing... all the way to quantum mechanics, apparently.

Can you imagine how boring life would be if nothing was random?

Well, I'm here to help you get a taste of that. I'm not going to go philosophical and discuss what it means to be 'random', so we're going to go with a simple definition of 'hard to predict', which is sufficient for our case.

For starters, how do we get our computers to spit out random numbers? Chances are you already know how: they can't. At least, not trivially. So we do the next best thing: we fake it by creating what *looks* to be random. In the world of computers, this is typically achieved using these nifty things called PRNGs - `PseudoRandom Number Generators`.

And they're super simple to make, too! Fundamentally, a PRNG is a function that takes some state as a parameter and then returns a (hopefully) random-looking output. They're so easy to make, in fact, that I'm about to prove it to you.
```rust
struct AwesomePRNG {
    state: u32,
}

impl AwesomePRNG {
    fn new(seed: u32) -> Self {
        Self { state: seed }
    }

    fn next(&mut self) -> u32 {
        self.state = (self.state * 4453 + 87) % 5;
        self.state
    }
}
```

Simple, right? We initialize our PRNG with a seed, which can be any number, and every time we want a random number, we simply call `next()`, which fiddles with the state and returns it. That's all we have to do. Our choice of numbers here is arbitrary, but that modulo means the numbers we return will range from 0 to 4 inclusive.

Now let's run our awesome PRNG and examine its output:
```rust
fn main() {
    let mut rng = AwesomePRNG::new(7333); // Pick any seed

    for _ in 0..10 {
        print!("{} ", rng.next());
    }
}
```
```
1 0 2 3 1 0 2 3 1 0 
```

... Ah. Well, maybe that's just a fluke. Let's try again and examine the first 20 numbers generated:
```
1 0 2 3 1 0 2 3 1 0 2 3 1 0 2 3 1 0 2 3 
```

Okay. We can obviously see here that our awesome PRNG is not as awesome as we initially thought. All we're getting is `1 0 2 3` in a repeating pattern.

Maybe we should tweak the numbers in our `next()` function? Let's try changing that `5` to `10`, so our output range is expanded?
```rust
fn next(&mut self) -> u32 {
    self.state = (self.state * 4453 + 87) % 10;
    self.state
}
```

And let's examine the first 20 numbers now:
```
6 5 2 3 6 5 2 3 6 5 2 3 6 5 2 3 6 5 2 3 
```

Well, that didn't help at all. We're repeating the same sequence of 4 numbers over and over. Let's tweak that `4453` to something bigger, then.
```rust
fn next(&mut self) -> u32 {
    self.state = (self.state * 13789 + 87) % 10;
    self.state
}
```

That should definitely help:
```
4 3 4 3 4 3 4 3 4 3 4 3 4 3 4 3 4 3 4 3 
```

...

... Okay, let's nudge that `87` then.
```rust
fn next(&mut self) -> u32 {
    self.state = (self.state * 13789 + 671) % 10;
    self.state
}
```

```
8 83 58 33 8 83 58 33 8 83 58 33 8 83 58 33 8 83 58 33 
```

Still horrible. We're somehow worse off than we started.

Alright, one more try. I'll replace all of those numbers with something random.
```rust
fn next(&mut self) -> u32 {
    self.state = (self.state * 66542 + 59) % 50;
    self.state
}
```

```
45 49 17 23 25 9 37 13 5 19 7 3 35 29 27 43 15 39 47 33 
```

... Hey, wait, that's not bad! I don't see any repeating periods, and the numbers *look* random!

Spoiler: print out the first 30 numbers instead of the first 20.
```
45 49 17 23 25 9 37 13 5 19 7 3 35 29 27 43 15 39 47 33 45 49 17 23 25 9 37 13 5 19
                                                        ^
```

We did not, in fact, fix the problem. While it's certainly better than our initial attempts, our PRNG repeats itself every 20 numbers.

Our PRNG here, by the way, actually belongs to a family of PRNGs called **LCG**s: Linear Congruential Generators. An LCG is defined as the recurrence relation `X_n+1 = (a * X_n + c) mod m`. That is, the next state is obtained by taking the current state, multiplying it by some number `a`, adding `c`, then taking the modulo `m` of the result, exactly what `AwesomePRNG` is doing.

... But `AwesomePRNG` isn't a *true* LCG, because there are additional restrictions to qualify as one:
1. `m > 0`
2. `0 < a < m`
3.  `0 <= c < m`
4. `0 <= X_0 (seed) < m`

(In the context of LCGs, `a` is called the multiplier while `c` is called the increment. `m` is just, well, the modulus)

So we're *almost* an LCG. We're just violating everything except `1`. Perhaps fixing that would give better results, so let's try again.
```rust
fn next(&mut self) -> u32 {
    self.state = (self.state * 31 + 17) % 50;
    self.state
}
```

And we'll also use the initial seed `12`. Let's print out the first 30 numbers:
```
39 26 23 30 47 24 11 8 15 32 9 46 43 0 17 44 31 28 35 2 29 16 13 20 37 14 1 48 5 22 
```

*Much* better. I don't see any repeating periods in there. But absence of evidence is not evidence of absence in this case, so I'm going to print out the first 100 numbers.
```
39 26 23 30 47 24 11 8 15 32 9 46 43 0 17 44 31 28 35 2 29 16 13 20 37 14 1 48 5 22 49 36 33 40 7 34 21 18 25 42 19 6 3 10 27 4 41 38 45 12
39 26 23 30 47 24 11 8 15 32 9 46 43 0 17 44 31 28 35 2 29 16 13 20 37 14 1 48 5 22 49 36 33 40 7 34 21 18 25 42 19 6 3 10 27 4 41 38 45 12 
```

I've split the line where the repetition starts. We didn't eliminate the periodicity, but interestingly, the period happens every 50 numbers - exactly our `m`. So let's try nudging `m` up to `100` and examining the output:
```
89 76 73 80 97 24 61 8 65 32 9 96 93 0 17 44 81 28 85 52 29 16 13 20 37 64 1 48 5 72 49 36 33 40 57 84 21 68 25 92 69 56 53 60 77 4 41 88 45 12
89 76 73 80 97 24 61 8 65 32 9 96 93 0 17 44 81 28 85 52 29 16 13 20 37 64 1 48 5 72 49 36 33 40 57 84 21 68 25 92 69 56 53 60 77 4 41 88 45 12 
```

Well, the output changed, but the periodicity hasn't. Keep `m` at 50 for now...

At this point, a programmer's first intuition would be one of two things:
1. LCGs are horrible at producing random-looking sequences
2. The specific combination of `a`, `c`, and `m` dictates the quality of the LCG

I don't want to give up on LCGs *just* yet, so let's keep trying different combinations. So far, we've been naively plugging random numbers. I'm no mathematician, but there's probably a way of figuring out way better ones than everything we've tried.

It's a simple recurrence relation, so surely it should be easy! Let's try to approach it analytically (but informally, because I actually don't like math).

Let's start off by examining `m`. Just to keep track of things, our LCG currently looks like this:
```rust
fn next(&mut self) -> u32 {
    self.state = (self.state * 31 + 17) % 50;
    self.state
}
```

We already know that going beyond 50 doesn't help periodicity at all. That alone is interesting, and we'll look into it in a moment. Right now, I want to see how the output changes as `m` climbs up from 1 to 10. For each `m`, we'll print out the first 15 numbers.

To make this easier, let's generalize `AwesomePRNG` into an `LCG` struct:
```rust
struct LCG {
    a: u32,
    c: u32,
    m: u32,
    state: u32,
}

impl LCG {
    fn new(a: u32, c: u32, m: u32, seed: u32) -> Self {
        Self { a, c, m, state: seed }
    }

    fn next(&mut self) -> u32 {
        self.state = (self.state * self.a + self.c) % self.m;
        self.state
    }
}
```

We haven't changed the algorithm at all, only un-hardcoded the numbers being used.

Now, for our setup:
```rust
fn main() {
    let (a, c) = (31, 17);
    
    for m in 1..=10 {
        let mut rng = LCG::new(a, c, m, 12);

        print!("m = {m}: ");
        for _ in 0..15 {
            print!("{} ", rng.next());
        }
        print!("\n");
    }
}
```

And let's examine our output:
```
m = 1:  0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 
m = 2:  1 0 1 0 1 0 1 0 1 0 1 0 1 0 1 
m = 3:  2 1 0 2 1 0 2 1 0 2 1 0 2 1 0 
m = 4:  1 0 1 0 1 0 1 0 1 0 1 0 1 0 1 
m = 5:  4 1 3 0 2 4 1 3 0 2 4 1 3 0 2 
m = 6:  5 4 3 2 1 0 5 4 3 2 1 0 5 4 3 
m = 7:  4 1 6 0 3 5 4 1 6 0 3 5 4 1 6 
m = 8:  5 4 5 4 5 4 5 4 5 4 5 4 5 4 5 
m = 9:  2 7 0 8 4 6 5 1 3 2 7 0 8 4 6 
m = 10: 9 6 3 0 7 4 1 8 5 2 9 6 3 0 7
```
