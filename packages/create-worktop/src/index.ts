import * as fs from 'fs';
import * as path from 'path';
import * as combos from '../../combos';

type Argv = {
	cwd: string;
	force?: boolean;
	typescript?: boolean;
	// TODO: monorepo
} & combos.Options;

async function mkdir(dir: string) {
	fs.existsSync(dir) || await fs.promises.mkdir(dir, { recursive: true });
}

// @modified lukeed/totalist
type Caller = (abs: string, rel: string, isDir: boolean) => Promise<void>;
async function list(dir: string, callback: Caller, prefix = '') {
	let files = await fs.promises.readdir(dir, { withFileTypes: true });

	await Promise.all(
		files.map(async dirent => {
			let rel = path.join(prefix, dirent.name);
			let item = path.join(dir, dirent.name);
			let isDir = dirent.isDirectory();

			await callback(item, rel, isDir);
			if (isDir) return list(item, callback, rel);
		})
	);
}

async function copy(src: string, dest: string) {
	// "foo/_gitignore" => "foo/.gitignore"
	dest = dest.replace(/([\\/]+)_/, '$1.');
	await fs.promises.copyFile(src, dest);
}

export async function setup(dir: string, argv: Argv) {
	argv.cwd = path.resolve(argv.cwd || '.');

	let source = path.join(__dirname, 'template');
	let target = path.join(argv.cwd, dir);

	if (fs.existsSync(target) && !argv.force) {
		let pretty = path.relative(process.cwd(), target);
		let msg = `Refusing to overwrite existing "${pretty}" directory.\n`;
		msg += 'Please specify a different directory or use the `--force` flag.';
		throw new Error(msg);
	}

	// TODO: may throw error; format it
	let { env, format } = combos.normalize(argv);

	let ext = argv.typescript ? 'ts' : 'js';
	let input = `src/${env}.${format}.${ext}`;
	let output = `src/index.${ext}`;
	let flags = '';

	if (env !== 'cfw') {
		flags += `--env ${env}`
	}
	if (format !== 'esm') {
		if (flags) flags += ' ';
		flags += `--format ${format}`
	}

	await mkdir(target);

	let root = path.join(source, 'root');
	await list(root, (abs, rel, isDir) => {
		let next = path.join(target, rel);
		return isDir ? mkdir(next) : copy(abs, next);
	});

	await fs.promises.rename(
		path.join(target, '.package.json'),
		path.join(target, 'package.json'),
	);

	let file = path.join(target, 'package.json');
	let pkg = require(file);

	await mkdir(
		path.join(target, 'src')
	);

	await fs.promises.copyFile(
		path.join(source, input),
		path.join(target, output),
	);

	// TODO: --cfw hook
	pkg.devDependencies['worktop.build'] = 'latest';
	pkg.scripts['build'] = `worktop build ${output}`;
	if (flags) pkg.scripts['build'] += ' ' + flags;

	if (env === 'cfw') {
		// TODO: wrangler.toml vs cfw file
		let file = `wrangler.${format}.toml`;

		await fs.promises.copyFile(
			path.join(source, 'config', file),
			path.join(target, 'wrangler.toml'),
		);
	}

	// TODO: remove if not wrangler
	if (env !== 'cfw' || format !== 'sw') {
		delete pkg.main;
	}

	await fs.promises.writeFile(
		file, JSON.stringify(pkg, null, 2)
	);
}