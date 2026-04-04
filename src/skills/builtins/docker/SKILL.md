---
name: docker
description: "Docker container and image management: build, run, compose, inspect, and debug containers. Use when working with Dockerfiles, docker-compose, or container orchestration."
---

# Docker Skill

## When to Use

- Building or running Docker images/containers
- Working with docker-compose or docker compose
- Debugging running containers
- Cleaning up Docker resources
- Inspecting container logs or configuration

## Key Commands

```bash
# Build
docker build -t myapp:latest .
docker build --no-cache -t myapp:latest .

# Run
docker run -it --rm -p 3000:3000 myapp:latest
docker run -d --name myapp -p 3000:3000 myapp:latest

# Compose
docker compose up -d
docker compose down
docker compose logs -f api
docker compose ps

# Inspect & Debug
docker ps
docker ps -a
docker logs mycontainer --tail 50 -f
docker exec -it mycontainer sh
docker inspect mycontainer

# Cleanup
docker system prune -f
docker volume prune -f
docker image prune -f
```

## Tips

- Always check `docker ps` first before debugging
- Use `docker exec -it <container> sh` (or `bash`) to get a shell
- `docker stats` for real-time resource usage
- `docker compose logs -f <service>` for live log tailing
- Prefer `docker compose` (v2) over `docker-compose` (v1)
