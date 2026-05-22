url="http://localhost:8080"

#Get Event by ID
echo "$url/event/1"
curl $url/event/1

echo "${url}/invite/1"
#Get Invite by ID
curl "${url}/invite/1"