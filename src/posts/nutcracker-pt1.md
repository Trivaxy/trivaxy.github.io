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

Hmm. For most sequences, the periodicity matches `m` exactly. Others like `m = 4` and `m = 7` seem to deviate from that pattern though.

Let's take a step back here and notice something. `m` directly dictates the state space of our LCG, as `self.state` will always be a number between `0` and `m-1`.

Not only that, but LCGs like ours are **deterministic** functions. Every single state will always map to one output only. That's a crucial observation, because it means the moment our LCG spits out a number it already spat out before, it has entered a loop.

Worse, we can see from our tests above that sometimes we enter loops without seeing the entire state space! Take that `m = 8` example. In ideal circumstances, we'd see every number from `0` to `7` before we inevitably enter a loop, but instead we only see `5` and `4` repeating.

So in a real sense, `m` represents the "capacity" of our LCG: the size of its state space. And since we know that the maximum period for any LCG is `m`, we have our first clue to making our LCG awesome again: we need to choose bigger values for `m`.

Which probably means that `a` and `c` are doing the heavy lifting of allowing the LCG to actually *reach* as many numbers in that state space as possible. Just because we have a high `m` doesn't mean the period will be that long. We need to choose `a` and `c` carefully so that as the LCG jumps around, it visits as much of the state space that it can.

Alright, let's try repeating the same experiment. This time, we want to investigate how `a` affects the output. We'll set `c = 7, m = 15`, and vary `a` from `1` to `m-1` (remember the constraints from earlier).

Since we also know that the moment we see a number repeated we've entered a loop, and that the max period is `m`, we can adjust our logic to detect the period size automatically:
```rust
fn main() {
    let (c, m) = (7, 15);
    // keep track of when exactly an output occurs for the first time
    let mut seen = HashMap::new();

    for a in 1..=m-1 {
        let mut rng = LCG::new(a, c, m, 12);
        seen.clear();

        print!("a = {a}: ");
        let mut i = 1;
        loop {
            let next = rng.next();
            print!("{next} ")

            if let Some(when) = seen.get(&next) {
                let period = i - when;
                print!("| period: {period}\n");
                break;
            }

            seen.insert(next, i);
            i += 1;
        }
    }
}
```

And now for the output:
```
a = 1: 4 11 3 10 2 9 1 8 0 7 14 6 13 5 12 4 | period: 15
a = 2: 1 9 10 12 1 | period: 4
a = 3: 13 1 10 7 13 | period: 4
a = 4: 10 2 0 7 5 12 10 | period: 6
a = 5: 7 12 7 | period: 2
a = 6: 4 1 13 10 7 4 | period: 5
a = 7: 1 14 0 7 11 9 10 2 6 4 5 12 1 | period: 12
a = 8: 13 6 10 12 13 | period: 4
a = 9: 10 7 10 | period: 2
a = 10: 7 2 12 7 | period: 3
a = 11: 4 6 13 0 7 9 1 3 10 12 4 | period: 10
a = 12: 1 4 10 7 1 | period: 4
a = 13: 13 11 0 7 8 6 10 2 3 1 5 12 13 | period: 12
a = 14: 10 12 10 | period: 2
```

Much nicer to read! We can see that `a` drastically affects the period. It seems that when `a = 1, c = 7, m = 15`, we get an LCG that *fully* explores the state space before looping. You can't get a better result than that.

The other sequences are interesting too - some are horrible, like `a = 5`, and others are 'decent', like `a = 7`, which only leaves a few numbers unvisited.

In fact, if you repeat this experiment by nudging `m` higher and higher, `a = 1` seems to consistently explore the full period. The implication here is that maybe `a` doesn't matter as much as `c`, but I'm skeptical.

So far, we've only tried messing with `m` and `a` individually. Rather than do the same for `c`, let's try fixing `m` to some number, and varying both `a` and `c`, recording *only* the combinations that give you full periods.

Perhaps that way we can get some way better insight. Let's do a quick refactor and set things up:
```rust
fn main() {
    let (m, seed) = (20, 12);
    
    for a in 1..m {
        for c in 0..m {
            let p = period(a, c, m, seed);
            if p == m {
                println!("a: {a}, c: {c}");
            }
        }
    }
}

fn period(a: u32, c: u32, m: u32, seed: u32) -> u32 {
    let mut seen = HashMap::new();
    let mut rng = LCG::new(a, c, m, seed);
    let mut i = 1u32;

    loop {
        let next = rng.next();

        if let Some(when) = seen.get(&next) {
            return i - when;
        }

        seen.insert(next, i);
        i += 1;
    }
}
```

Output:
```
a: 1, c: 1
a: 1, c: 3
a: 1, c: 7
a: 1, c: 9
a: 1, c: 11
a: 1, c: 13
a: 1, c: 17
a: 1, c: 19
```

All of the above combinations will lead to a full period for `m = 20`. Notice anything interesting?

In each of them (except the first), `c` is a prime number. The first combination is actually trivial - it simply enumerates the state space directly. The rest are cooler.

Alright, one more change - this time, we're going to vary `a`, `c`, and `m` to figure out which combinations lead to full periods:
```rust
fn main() {
    let seed = 12;
    
    for m in 1..100 {
        for a in 1..m {
            for c in 0..m {
                let p = period(a, c, m, seed);
                if p == m {
                    println!("a: {a}, c: {c}, m: {m}");
                }
            }
        }
    }
}
```

This brute-force search actually yields just above ~7000 combinations that give you full-period LCGs! Compared to the search space, which is about ~320,000 combinations, only about ~2% actually give you full periods, and I suspect this percentage only shrinks the bigger you go.

To give your scrollwheel a break, I'm going to randomly pluck a handful of those ~7000 so we can look for patterns. Our goal is to find *some* kind of universal relationship between `a`, `c`, and `m`.

```
a: 1, c: 4, m: 9
a: 17, c: 15, m: 64
a: 16, c: 77, m: 81
a: 67, c: 74, m: 81
a: 45, c: 79, m: 88
a: 25, c: 61, m: 96
a: 67, c: 98, m: 99
```

Well. I don't see anything obvious right off the bat. It's obvious there isn't a linear relationship between those numbers, so that rules out any kind of linear regression.

Here's a hunch: let's break down every number in there down to its prime factors. We saw earlier an interesting pattern where `c` was prime each time we achieved a full period when `a = 1, m = 20`. That's most definitely not a coincidence.

So:
```
a: 1, c: 2^2, m: 3^2
a: 17, c: 3 * 5, m: 2^6
a: 2^4, c: 7 * 11, m: 3^4
a: 67, c: 2 * 37, m: 3^4
a: 3^2 * 5, c: 79, m: 2^3 * 11
a: 5^2, c: 61, m: 2^5 * 3
a: 67, c: 7^2 * 2, m: 3^2 * 11
```

Taking a look at `c` and `m`, not a single time have they shared any common factors!

Intuitively, this actually makes sense. Let's imagine the state space as a line of seats. Suppose `m = 10`, `a = 1` (so we can ignore it), and that `c = 2`. In this case, the GCD between `m` and `c` is `2`.

Now let's suppose we simply have the seed set to `0`, and we can trace how the LCG explores the space:
```
[0, 1, 2, 3, 4, 5, 6, 7, 8, 9]
 ^ start here

[0, 1, 2, 3, 4, 5, 6, 7, 8, 9]
       ^ now here

[0, 1, 2, 3, 4, 5, 6, 7, 8, 9]
             ^ now here

             ...

[0, 1, 2, 3, 4, 5, 6, 7, 8, 9]
 once we've reached 8,   ^
 we'll wrap around to 9
```

Even though the state space is 10 numbers, the step size of `c` means you will never see odd numbers. Because `m` can divide `c`, it means you can *always* keep moving forwards by `c` until you exactly hit `m` and wrap around back to 0.

The only way to actually reach the other states is changing the initial starting seeds, and if you do, you'll notice that you actually have 2 distinct possible loops for this LCG:
```
seed = 0
0 -> 2 -> 4 -> 6 -> 8 -> 0

seed = 1
1 -> 3 -> 5 -> 7 -> 9 -> 1
```

Still, the loop we find ourselves in doesn't matter. It's a bad result.
