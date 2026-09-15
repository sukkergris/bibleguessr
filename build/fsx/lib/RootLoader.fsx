open System.IO

module RootLoader =

    /// Find the project root by searching upward for a file named 'root-marker'
    let rec private searchUpwards (dir: string) : string option =
        let marker = Path.Combine(dir, "root-marker")

        if File.Exists(marker) then
            Some dir
        else
            let parent = Directory.GetParent(dir)
            match parent with
            | null -> None
            | p -> searchUpwards p.FullName

    /// Public API: returns the root folder or throws
    let findRoot (startDir: string) : string =
        match searchUpwards startDir with
        | Some root ->
            printf "%s" $"Root folder: {root}\n"
            root
        | None -> failwith $"Could not find root-marker starting from: {startDir}"
