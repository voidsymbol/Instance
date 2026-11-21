// ─────────────────────────────────────────────────────────────────────────────
//  INSTANCE.JS — USAGE EXAMPLES
// ─────────────────────────────────────────────────────────────────────────────

// Coming Soon

// ── 1. The basics ─────────────────────────────────────────────────────────────

class ProductCard extends Div {

    ['@insertion']() { // ['@append'](context) // ['@before'](context) ['@after'](context) ['@firstchild'](context) ['@lastchild'](context) {} context optional arg
        this.addClass('card--loading')
            .get('/api/product/' + this.dataset.id)
            .then(r => r.json())
            .then(product => {
                this.setText(product.name)
                this.removeClass('card--loading')
                this.$.price = product.price
            })
    }

    ['@rendered']() {
        this.on('click', () => this.trigger('add-to-cart'))
        this.addClass('card--visible')
    }

    ['@removal']() {
        this.$.price = null
    }
}

new ProductCard('@third from last child of #catalogue')
    .set('data-id', this.productId);

const div  = new Div();
const span = new Span();
const btn  = new Button();

btn
    .setText('Click me')
    .addClass('btn-primary')
    .on('click', e => console.log('clicked'))
    .appendTo('#app');


// ── 2. Subclassing ────────────────────────────────────────────────────────────

class Card extends Div {
    constructor(title, body) {
        super();
        this.addClass('card')
            .setText(title);
    }
}

class HeroCard extends Card {
    constructor(title, body) {
        super(title, body);
        this.addClass('hero');
    }
}

new HeroCard('Hello', 'World').appendTo('#app');

// instanceof works at every level — natively
console.log(card instanceof HeroCard);       // true
console.log(card instanceof Card);           // true
console.log(card instanceof Div);            // true
console.log(card instanceof HTMLDivElement); // true
console.log(card instanceof Instance);       // true


// ── 3. Lifecycle ──────────────────────────────────────────────────────────────

class Tooltip extends Div {

    ['@insertion']() {
        this.addClass('tooltip--visible');
        console.log('tooltip mounted');
    }

    ['@removal']() {
        console.log('tooltip cleaned up');
    }

    ['@rendered']() {
        // fires after first paint
        this.style.opacity = '1';
    }

    ['@attributeChanged']({ name, oldValue, newValue }) {
        if (name === 'data-content') {
            this.setText(newValue);
        }
    }
}


// ── 4. Reactive state ─────────────────────────────────────────────────────────

class Counter extends Button {

    ['@insertion']() {
        this.$.count = 0;

        Instance.effect(() => {
            this.setText(`Clicked ${this.$.count} times`);
        });

        this.on('click', () => {
            this.$.count++;
        });
    }
}


// ── 5. Reactive — three scopes ────────────────────────────────────────────────

// Per-element
const card = new Card();
card.$.title = 'Hello';

// Per-class (shared across all Cards)
Card.$.theme = 'dark';

// App-scope (shared across everything)
Instance.$.currentUser = { name: 'Ada' };

// All three are signals — effects re-run when they change
Instance.effect(() => {
    console.log(
        card.$.title,
        Card.$.theme,
        Instance.$.currentUser.name
    );
});


// ── 6. Fetch and load ─────────────────────────────────────────────────────────

class SubArticle extends Article {

    ['@insertion']() {
        const id = this.dataset.articleId;

        // raw fetch — you handle the response
        this.fetch(`/api/articles/${id}`)
            .then(r => r.json())
            .then(data => {
                this.$.article = data;
            });
    }
}

// or just load HTML directly
class Sidebar extends Nav {

    ['@insertion']() {
        this.load('/partials/sidebar.html')
            .then(el => el.addClass('sidebar--ready'));
    }
}

// or lazy — waits for viewport
class FeedItem extends Li {

    ['@insertion']() {
        this.lazyLoad(`/api/feed/${this.dataset.id}`)
            .then(el => el.addClass('loaded'));
    }
}


// ── 7. HTTP methods ───────────────────────────────────────────────────────────

class SearchBar extends Form {

    ['@insertion']() {
        this.on('submit', e => {
            e.preventDefault();

            // GET with params — auto URLSearchParams
            this.get('/api/search', { q: this.querySelector('input').value })
                .then(r => r.json())
                .then(results => {
                    Instance.$.searchResults = results;
                });
        });
    }
}

class LoginForm extends Form {

    ['@insertion']() {
        this.on('submit', e => {
            e.preventDefault();

            // POST with JSON body
            this.post('/api/auth/login', {
                email:    this.querySelector('[name=email]').value,
                password: this.querySelector('[name=password]').value
            })
            .then(r => r.json())
            .then(user => {
                Instance.$.currentUser = user;
            });
        });
    }
}

// smart router — infers GET or POST from payload
this.query('/api/data', { page: 1, limit: 10 });      // → GET
this.query('/api/data', { filters: { active: true } }); // → POST


// ── 8. WebSocket ──────────────────────────────────────────────────────────────

class LiveChart extends Canvas {

    ['@insertion']() {
        // callable — connects, returns the proxy
        this.socket('wss://data.example.com/stream')
            .on('message', ({ data }) => {
                this.$.points = JSON.parse(data).points;
            })
            .on('error', e => {
                console.warn('socket error', e);
            });

        Instance.effect(() => {
            this.redraw(this.$.points);
        });
    }

    redraw(points) {
        // canvas drawing logic
    }
}
// socket closes automatically on element removal


// ── 9. Worker ─────────────────────────────────────────────────────────────────

class ImageProcessor extends Canvas {

    ['@insertion']() {
        this.on('drop', e => {
            const file = e.dataTransfer.files[0];

            // fire and forget — self-terminating worker
            this.worker(processImage, file)
                .then(result => this.drawResult(result));
        });
    }

    drawResult(result) {
        // draw processed image data
    }
}

// or persistent worker — reused across calls
class VideoEncoder extends Div {

    ['@insertion']() {
        // persistent — worker stays alive
        this.on('data', ({ detail }) => {
            this.worker.run(encodeFrame, detail.frame)
                .then(encoded => this.$.buffer.push(encoded));
        });
    }
}
// worker terminates automatically on element removal


// ── 10. PostMessage ───────────────────────────────────────────────────────────

class IFrameHost extends IFrame {

    ['@insertion']() {
        // subscribe to a named channel
        this.listen('iframe-ready', (data) => {
            this.listen.post('host-config', {
                theme: Instance.$.theme,
                user:  Instance.$.currentUser
            });
        });

        this.listen('iframe-event', (data) => {
            this.trigger('child-event', data);
        });
    }
}


// ── 11. div.this chain ────────────────────────────────────────────────────────

class FancyCard extends Card {
    whoami() {
        console.log(this.this);             // FancyCard
        console.log(this.this.this);        // Card
        console.log(this.this.this.this);   // Div
        console.log(this.this.this.this.this);          // Instance
        console.log(this.this.this.this.this.this);     // Window
        console.log(this.this.this.this.this.this.this); // Window
    }
}

// static side — same walk
console.log(FancyCard.this);  // Card
console.log(Card.this);       // Div
console.log(Div.this);        // Instance
console.log(Instance.this);   // Window


// ── 12. .native and .instance ─────────────────────────────────────────────────

// from the class side
console.log(Div.native);          // HTMLDivElement
console.log(Span.native);         // HTMLSpanElement
console.log(FancyCard.native);    // HTMLDivElement (inherited)

// from the element side — useful in variadic constructors
class Adapter extends Instance {
    constructor(el) {
        super(el);
        console.log(this.instance); // whatever backs el — HTMLDivElement, HTMLInputElement etc.
    }
}


// ── 13. Composition ───────────────────────────────────────────────────────────

class DataTable extends Table {

    ['@insertion']() {
        this.get('/api/data', { page: 1 })
            .then(r => r.json())
            .then(({ rows, total }) => {
                this.$.rows  = rows;
                this.$.total = total;
            });

        Instance.effect(() => {
            this.renderRows(this.$.rows ?? []);
        });
    }

    renderRows(rows) {
        rows.forEach(row => {
            new Tr()
                .init(el => {
                    Object.entries(row).forEach(([key, val]) => {
                        new Td().setText(val).appendTo(el);
                    });
                })
                .appendTo(this);
        });
    }
}


// ── 14. init() — attach behaviours ───────────────────────────────────────────

const draggable = {
    attach(el) {
        el.on('mousedown', startDrag);
        el.on('mouseup',   stopDrag);
    }
};

const resizable = (el) => {
    el.style.resize = 'both';
    el.style.overflow = 'auto';
};

new Div()
    .addClass('panel')
    .init(draggable, resizable)
    .appendTo('#app');


// ── 15. Putting it all together ───────────────────────────────────────────────

class Dashboard extends Main {

    ['@insertion']() {

        // App-scope reactive state
        Instance.$.loading = true;

        // Fetch initial data
        this.get('/api/dashboard', { userId: Instance.$.currentUser?.id })
            .then(r => r.json())
            .then(data => {
                Instance.$.dashboard = data;
                Instance.$.loading   = false;
            });

        // Live updates via WebSocket
        this.socket(`wss://live.example.com/dashboard`)
            .on('message', ({ data }) => {
                Instance.$.dashboard = {
                    ...Instance.$.dashboard,
                    ...JSON.parse(data)
                };
            });

        // Render reactively
        Instance.effect(() => {
            if (Instance.$.loading) {
                this.addClass('loading');
            } else {
                this.removeClass('loading');
                this.render(Instance.$.dashboard);
            }
        });
    }

    render(data) {
        new DataTable()
            .appendTo(this);

        new LiveChart()
            .attr('data-metric', 'revenue')
            .appendTo(this);
    }
}

new Dashboard().appendTo('body');

// That's it. That's the whole app.
