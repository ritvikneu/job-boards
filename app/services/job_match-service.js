import { config } from 'dotenv';
config();
class TrieNode {
    constructor() {
        this.children = {};
        this.isEndOfWord = false;
    }
}

class Trie {
    constructor() {
        this.root = new TrieNode();
    }

    insert(word) {
        let node = this.root;
        for (const char of word) {
            if (!node.children[char]) {
                node.children[char] = new TrieNode();
            }
            node = node.children[char];
        }
        node.isEndOfWord = true;
    }

    search(word) {
        let node = this.root;
        for (const char of word) {
            if (!node.children[char]) {
                return false;
            }
            node = node.children[char];
        }
        return node.isEndOfWord;
    }
}

class JobChecker {
     constructor() {
        const jobTitles = process.env.JOB_TITLES.split(",");
        const ignoreTitles = process.env.IGNORE_TITLES.split(",");
        
        this.acceptTrie = new Trie();
        this.ignoreTrie = new Trie();

        jobTitles.forEach(title => this.acceptTrie.insert(title.toLowerCase()));
        ignoreTitles.forEach(title => this.ignoreTrie.insert(title.toLowerCase()));
    }

    isJobPresentAccept(title) {
        title = title.toLowerCase();
        for (let i = 0; i < title.length; i++) {
            for (let j = i + 1; j <= title.length; j++) {
                const substring = title.substring(i, j);
                if (this.acceptTrie.search(substring)) {
                    if (!this.ignoreTrie.search(substring)) {
                        return true;
                    }
                }
            }
        }
        return false;
    }

    isJobPresentReject(title) {
        title = title.toLowerCase();
        for (let i = 0; i < title.length; i++) {
            for (let j = i + 1; j <= title.length; j++) {
                const substring = title.substring(i, j);
                if (this.ignoreTrie.search(substring)) {
                    return true;
                }
            }
        }
        return false;
    }
}


const jobChecker = new JobChecker();

// const jobsToCheck = ["software engineer, machine learning", "staff Support software engineer", "Frontend Engineer", "Data Scientist", "Developer"];

// jobsToCheck.forEach(title => {
//     if (jobChecker.isJobPresentAccept(title)) {
//         if (!jobChecker.isJobPresentReject(title)) {
//             console.log(`'${title}'`);
//         }
//     }
// });

export { jobChecker };
