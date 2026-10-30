export namespace claudeacct {
	
	export class Login {
	    loggedIn: boolean;
	    email: string;
	    displayName: string;
	    organization: string;
	    role: string;
	    billing: string;
	    subscription: string;
	    rateLimitTier: string;
	    // Go type: time
	    tokenExpiresAt: any;
	
	    static createFrom(source: any = {}) {
	        return new Login(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.loggedIn = source["loggedIn"];
	        this.email = source["email"];
	        this.displayName = source["displayName"];
	        this.organization = source["organization"];
	        this.role = source["role"];
	        this.billing = source["billing"];
	        this.subscription = source["subscription"];
	        this.rateLimitTier = source["rateLimitTier"];
	        this.tokenExpiresAt = this.convertValues(source["tokenExpiresAt"], null);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class Window {
	    key: string;
	    label: string;
	    percent: number;
	    // Go type: time
	    resetsAt: any;
	
	    static createFrom(source: any = {}) {
	        return new Window(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.key = source["key"];
	        this.label = source["label"];
	        this.percent = source["percent"];
	        this.resetsAt = this.convertValues(source["resetsAt"], null);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class Usage {
	    windows: Window[];
	    // Go type: time
	    fetchedAt: any;
	
	    static createFrom(source: any = {}) {
	        return new Usage(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.windows = this.convertValues(source["windows"], Window);
	        this.fetchedAt = this.convertValues(source["fetchedAt"], null);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

export namespace files {
	
	export class Content {
	    path: string;
	    text: string;
	    size: number;
	    binary: boolean;
	    truncated: boolean;
	
	    static createFrom(source: any = {}) {
	        return new Content(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.text = source["text"];
	        this.size = source["size"];
	        this.binary = source["binary"];
	        this.truncated = source["truncated"];
	    }
	}
	export class Entry {
	    name: string;
	    path: string;
	    dir: boolean;
	    size: number;
	
	    static createFrom(source: any = {}) {
	        return new Entry(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.path = source["path"];
	        this.dir = source["dir"];
	        this.size = source["size"];
	    }
	}
	export class SearchResult {
	    entries: Entry[];
	    truncated: boolean;
	
	    static createFrom(source: any = {}) {
	        return new SearchResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.entries = this.convertValues(source["entries"], Entry);
	        this.truncated = source["truncated"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

export namespace main {
	
	export class AppInfo {
	    version: string;
	
	    static createFrom(source: any = {}) {
	        return new AppInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.version = source["version"];
	    }
	}
	export class Article {
	    name: string;
	    url: string;
	    tech: string;
	
	    static createFrom(source: any = {}) {
	        return new Article(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.url = source["url"];
	        this.tech = source["tech"];
	    }
	}
	export class ClaudeUsageData {
	    login: claudeacct.Login;
	    usage: claudeacct.Usage;
	    usageError?: string;
	    alertPercent: number;
	    alert: boolean;
	
	    static createFrom(source: any = {}) {
	        return new ClaudeUsageData(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.login = this.convertValues(source["login"], claudeacct.Login);
	        this.usage = this.convertValues(source["usage"], claudeacct.Usage);
	        this.usageError = source["usageError"];
	        this.alertPercent = source["alertPercent"];
	        this.alert = source["alert"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class Recommendation {
	    instance: widget.Instance;
	    reason: string;
	    suggestedCommand?: string;
	
	    static createFrom(source: any = {}) {
	        return new Recommendation(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.instance = this.convertValues(source["instance"], widget.Instance);
	        this.reason = source["reason"];
	        this.suggestedCommand = source["suggestedCommand"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class Sprites {
	    characters: string[];
	    guide: string;
	
	    static createFrom(source: any = {}) {
	        return new Sprites(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.characters = source["characters"];
	        this.guide = source["guide"];
	    }
	}
	export class Todo {
	    id: string;
	    text: string;
	    done: boolean;
	    // Go type: time
	    created: any;
	    // Go type: time
	    doneAt?: any;
	
	    static createFrom(source: any = {}) {
	        return new Todo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.text = source["text"];
	        this.done = source["done"];
	        this.created = this.convertValues(source["created"], null);
	        this.doneAt = this.convertValues(source["doneAt"], null);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class WidgetResult {
	    type: string;
	    data?: any;
	    error?: string;
	    setup?: string;
	    // Go type: time
	    fetchedAt: any;
	
	    static createFrom(source: any = {}) {
	        return new WidgetResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.type = source["type"];
	        this.data = source["data"];
	        this.error = source["error"];
	        this.setup = source["setup"];
	        this.fetchedAt = this.convertValues(source["fetchedAt"], null);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

export namespace sessions {
	
	export class Record {
	    sessionId: string;
	    workspaceId: string;
	    title: string;
	    // Go type: time
	    startedAt: any;
	    // Go type: time
	    lastActive: any;
	    open: boolean;
	    named?: boolean;
	
	    static createFrom(source: any = {}) {
	        return new Record(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.sessionId = source["sessionId"];
	        this.workspaceId = source["workspaceId"];
	        this.title = source["title"];
	        this.startedAt = this.convertValues(source["startedAt"], null);
	        this.lastActive = this.convertValues(source["lastActive"], null);
	        this.open = source["open"];
	        this.named = source["named"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

export namespace term {
	
	export class Info {
	    id: string;
	    title: string;
	    dir: string;
	    kind: string;
	    session?: string;
	
	    static createFrom(source: any = {}) {
	        return new Info(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.title = source["title"];
	        this.dir = source["dir"];
	        this.kind = source["kind"];
	        this.session = source["session"];
	    }
	}

}

export namespace tokens {
	
	export class Totals {
	    today: number;
	    week: number;
	
	    static createFrom(source: any = {}) {
	        return new Totals(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.today = source["today"];
	        this.week = source["week"];
	    }
	}

}

export namespace widget {
	
	export class SettingSpec {
	    key: string;
	    label: string;
	    kind: string;
	    default: any;
	    options?: string[];
	    min: number;
	    max: number;
	    description?: string;
	
	    static createFrom(source: any = {}) {
	        return new SettingSpec(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.key = source["key"];
	        this.label = source["label"];
	        this.kind = source["kind"];
	        this.default = source["default"];
	        this.options = source["options"];
	        this.min = source["min"];
	        this.max = source["max"];
	        this.description = source["description"];
	    }
	}
	export class Definition {
	    id: string;
	    name: string;
	    description: string;
	    source: string;
	    settings: SettingSpec[];
	    multiple: boolean;
	
	    static createFrom(source: any = {}) {
	        return new Definition(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.description = source["description"];
	        this.source = source["source"];
	        this.settings = this.convertValues(source["settings"], SettingSpec);
	        this.multiple = source["multiple"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class Instance {
	    type: string;
	    id?: string;
	    title?: string;
	    enabled: boolean;
	    settings?: Record<string, any>;
	
	    static createFrom(source: any = {}) {
	        return new Instance(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.type = source["type"];
	        this.id = source["id"];
	        this.title = source["title"];
	        this.enabled = source["enabled"];
	        this.settings = source["settings"];
	    }
	}

}

export namespace workspace {
	
	export class Workspace {
	    id: string;
	    name: string;
	    folders: string[];
	    widgets: widget.Instance[];
	    notes?: string;
	    topics?: string[];
	
	    static createFrom(source: any = {}) {
	        return new Workspace(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.folders = source["folders"];
	        this.widgets = this.convertValues(source["widgets"], widget.Instance);
	        this.notes = source["notes"];
	        this.topics = source["topics"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class ListResult {
	    workspaces: Workspace[];
	    problems: string[];
	
	    static createFrom(source: any = {}) {
	        return new ListResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.workspaces = this.convertValues(source["workspaces"], Workspace);
	        this.problems = source["problems"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

