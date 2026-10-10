/*
 * ============================================================
 *  DSA Project — Maze Solver using Graph + BFS (C Language)
 * ============================================================
 *
 *  CONCEPT:
 *  - The maze is represented as a GRAPH
 *  - Each open cell (non-wall) is a NODE
 *  - Adjacent open cells are connected by EDGES
 *  - BFS (Breadth-First Search) finds the SHORTEST path
 *    from Start node to End node
 *
 *  EXPORTED FUNCTIONS (called from JavaScript via WebAssembly):
 *  - solve_maze(grid, rows, cols, start, end) -> path array
 *  - get_path_length() -> int
 *  - get_nodes_visited() -> int
 *
 * ============================================================
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#ifdef __EMSCRIPTEN__
#include <emscripten.h>
#define EXPORT EMSCRIPTEN_KEEPALIVE
#else
#define EXPORT
#endif

/* ──────────────────────────────────────────────
   GRAPH DATA STRUCTURES
   ────────────────────────────────────────────── */

#define MAX_NODES  8192   /* supports up to 63x63 (3969) and 64x64 (4096) maze */
#define MAX_EDGES  4      /* each cell has at most 4 neighbors (N,S,E,W) */

/* Adjacency List Node */
typedef struct AdjNode {
    int dest;
    struct AdjNode* next;
} AdjNode;

/* Graph */
typedef struct {
    int      num_nodes;
    AdjNode* adj[MAX_NODES];
} Graph;

/* BFS Queue */
typedef struct {
    int data[MAX_NODES];
    int front, rear;
} Queue;

/* ──────────────────────────────────────────────
   GLOBAL STATE (shared with JS via WASM memory)
   ────────────────────────────────────────────── */

static int g_path[MAX_NODES];       /* solution path (node indices) */
static int g_path_length  = 0;
static int g_nodes_visited = 0;

/* ──────────────────────────────────────────────
   GRAPH HELPER FUNCTIONS
   ────────────────────────────────────────────── */

/* Create a new adjacency list node */
AdjNode* new_adj_node(int dest) {
    AdjNode* node = (AdjNode*)malloc(sizeof(AdjNode));
    node->dest = dest;
    node->next = NULL;
    return node;
}

/* Add an undirected edge between u and v */
void add_edge(Graph* g, int u, int v) {
    /* u → v */
    AdjNode* node = new_adj_node(v);
    node->next = g->adj[u];
    g->adj[u] = node;

    /* v → u (undirected) */
    node = new_adj_node(u);
    node->next = g->adj[v];
    g->adj[v] = node;
}

/* Free all adjacency list memory */
void free_graph(Graph* g) {
    for (int i = 0; i < g->num_nodes; i++) {
        AdjNode* curr = g->adj[i];
        while (curr) {
            AdjNode* tmp = curr;
            curr = curr->next;
            free(tmp);
        }
        g->adj[i] = NULL;
    }
}

/* ──────────────────────────────────────────────
   QUEUE OPERATIONS (for BFS)
   ────────────────────────────────────────────── */

void queue_init(Queue* q) {
    q->front = q->rear = 0;
}

int queue_empty(Queue* q) {
    return q->front == q->rear;
}

void queue_push(Queue* q, int val) {
    q->data[q->rear++] = val;
}

int queue_pop(Queue* q) {
    return q->data[q->front++];
}

/* ──────────────────────────────────────────────
   CORE BFS ALGORITHM
   - Explores the graph level by level
   - Guarantees the SHORTEST path
   - Tracks parent[] to reconstruct path
   ────────────────────────────────────────────── */

int bfs(Graph* g, int start, int end, int* parent) {
    int visited[MAX_NODES];
    memset(visited, 0, sizeof(visited));
    memset(parent,  -1, MAX_NODES * sizeof(int));

    Queue q;
    queue_init(&q);

    visited[start] = 1;
    queue_push(&q, start);
    g_nodes_visited = 0;

    while (!queue_empty(&q)) {
        int curr = queue_pop(&q);
        g_nodes_visited++;

        /* Found the destination! */
        if (curr == end) return 1;

        /* Explore all neighbors */
        AdjNode* nbr = g->adj[curr];
        while (nbr) {
            if (!visited[nbr->dest]) {
                visited[nbr->dest] = 1;
                parent[nbr->dest] = curr;
                queue_push(&q, nbr->dest);
            }
            nbr = nbr->next;
        }
    }

    return 0; /* No path found */
}

/* ──────────────────────────────────────────────
   MAIN EXPORTED FUNCTION: solve_maze
   
   Parameters (from JavaScript):
     grid[]  : flat int array (0=wall, 1=open)
     rows    : number of rows
     cols    : number of columns
     start   : index of start cell
     end     : index of end cell

   Returns:
     Pointer to g_path[] array on success
     NULL on failure (no path)
   ────────────────────────────────────────────── */

EXPORT
int* solve_maze(int* grid, int rows, int cols, int start, int end) {
    int num_nodes = rows * cols;

    /* ── Build the Graph ── */
    Graph g;
    g.num_nodes = num_nodes;
    for (int i = 0; i < num_nodes; i++) g.adj[i] = NULL;

    /*
     * For each open cell, check its RIGHT and DOWN neighbors.
     * If the neighbor is also open, add an undirected edge.
     * (We only check right+down to avoid duplicate edges)
     */
    for (int r = 0; r < rows; r++) {
        for (int c = 0; c < cols; c++) {
            int idx = r * cols + c;
            if (!grid[idx]) continue; /* skip walls */

            /* Right neighbor */
            if (c + 1 < cols && grid[r * cols + (c + 1)]) {
                add_edge(&g, idx, r * cols + (c + 1));
            }

            /* Down neighbor */
            if (r + 1 < rows && grid[(r + 1) * cols + c]) {
                add_edge(&g, idx, (r + 1) * cols + c);
            }
        }
    }

    /* ── Run BFS ── */
    int parent[MAX_NODES];
    int found = bfs(&g, start, end, parent);

    /* ── Free Graph Memory ── */
    free_graph(&g);

    if (!found) {
        g_path_length = 0;
        return NULL; /* No path found */
    }

    /* ── Reconstruct Path (trace back via parent[]) ── */
    int temp[MAX_NODES];
    int len = 0;
    int curr = end;

    while (curr != -1) {
        temp[len++] = curr;
        curr = parent[curr];
    }

    /* Reverse to get start→end order */
    g_path_length = len;
    for (int i = 0; i < len; i++) {
        g_path[i] = temp[len - 1 - i];
    }

    return g_path;
}

/* ──────────────────────────────────────────────
   GETTER FUNCTIONS (called from JS)
   ────────────────────────────────────────────── */

EXPORT
int get_path_length(void) {
    return g_path_length;
}

EXPORT
int get_nodes_visited(void) {
    return g_nodes_visited;
}

/* ──────────────────────────────────────────────
   STANDALONE TEST MAIN (for direct C testing)
   Only compiled when NOT building for WASM
   ────────────────────────────────────────────── */

#ifndef __EMSCRIPTEN__
int main(void) {
    printf("=== Maze Solver - Graph BFS Test ===\n\n");

    /*
     * Test Maze (5x5):
     *  1=open, 0=wall
     *
     *   S . # # #
     *   . # . . #
     *   . # . # #
     *   . . . # .
     *   # # . . E
     */
    int rows = 5, cols = 5;
    int grid[25] = {
        1, 1, 0, 0, 0,
        1, 0, 1, 1, 0,
        1, 0, 1, 0, 0,
        1, 1, 1, 0, 1,
        0, 0, 1, 1, 1
    };

    int start = 0;              /* top-left */
    int end   = rows*cols - 1;  /* bottom-right */

    printf("Maze Grid (%dx%d):\n", rows, cols);
    for (int r = 0; r < rows; r++) {
        for (int c = 0; c < cols; c++) {
            if (r * cols + c == start)      printf("S ");
            else if (r * cols + c == end)   printf("E ");
            else printf("%c ", grid[r*cols+c] ? '.' : '#');
        }
        printf("\n");
    }
    printf("\n");

    int* path = solve_maze(grid, rows, cols, start, end);

    if (!path) {
        printf("No path found!\n");
        return 1;
    }

    printf("BFS Solution Found!\n");
    printf("Path length : %d steps\n", get_path_length());
    printf("Nodes visited: %d\n", get_nodes_visited());
    printf("Path: ");
    for (int i = 0; i < get_path_length(); i++) {
        int node = path[i];
        printf("(%d,%d)", node / cols, node % cols);
        if (i < get_path_length() - 1) printf(" -> ");
    }
    printf("\n");

    return 0;
}
#endif
